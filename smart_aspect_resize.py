import math

import torch
import comfy.utils
import nodes


ASPECT_RATIOS = [
    "from image",
    "custom",
    "1:1",
    "2:3",
    "3:2",
    "3:4",
    "4:3",
    "4:5",
    "5:4",
    "9:16",
    "16:9",
    "21:9",
]


def _snap(value, snap_to):
    value = max(1, int(round(value)))
    snap_to = max(1, int(snap_to))
    if snap_to <= 1:
        return value
    return max(snap_to, int(round(value / snap_to) * snap_to))


def _ratio_from_string(aspect_ratio, image_width, image_height, custom_aspect_width, custom_aspect_height):
    if aspect_ratio == "from image":
        return max(1, image_width) / max(1, image_height)
    if aspect_ratio == "custom":
        return max(1, custom_aspect_width) / max(1, custom_aspect_height)

    left, right = aspect_ratio.split(":", 1)
    return max(1, int(left)) / max(1, int(right))


def _ratio_label(width, height):
    divisor = math.gcd(max(1, int(width)), max(1, int(height)))
    return f"{int(width) // divisor}:{int(height) // divisor}"


def _target_size(image_width, image_height, aspect_ratio, width, height, locked, custom_aspect_width, custom_aspect_height, snap_to):
    ratio = _ratio_from_string(aspect_ratio, image_width, image_height, custom_aspect_width, custom_aspect_height)
    width = image_width if width <= 0 else width
    height = image_height if height <= 0 else height

    if locked == "width":
        target_width = width
        target_height = target_width / ratio
    elif locked == "height":
        target_height = height
        target_width = target_height * ratio
    else:
        target_width = width
        target_height = target_width / ratio

    target_width = _snap(target_width, snap_to)
    target_height = _snap(target_height, snap_to)

    return target_width, target_height, _ratio_label(target_width, target_height)


class SmartAspectResize:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "aspect_ratio": (ASPECT_RATIOS,),
                "width": ("INT", {"default": 1024, "min": 0, "max": nodes.MAX_RESOLUTION, "step": 1}),
                "height": ("INT", {"default": 1024, "min": 0, "max": nodes.MAX_RESOLUTION, "step": 1}),
                "locked": (["aspect_ratio", "width", "height"],),
                "fit": (["contain", "crop", "pad", "stretch"],),
                "upscale_method": (nodes.ImageScale.upscale_methods,),
                "snap_to": ("INT", {"default": 8, "min": 1, "max": 256, "step": 1}),
            },
            "optional": {
                "image": ("IMAGE",),
                "custom_aspect_width": ("INT", {"default": 1, "min": 1, "max": 9999, "step": 1}),
                "custom_aspect_height": ("INT", {"default": 1, "min": 1, "max": 9999, "step": 1}),
                "pad_color": (["black", "white"],),
            },
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT", "STRING", "INT", "INT")
    RETURN_NAMES = ("image", "width", "height", "aspect_ratio", "original_width", "original_height")
    FUNCTION = "resize"
    CATEGORY = "image/resize"
    DESCRIPTION = "Resize an image with live width, height, and aspect-ratio locking."

    def resize(
        self,
        aspect_ratio,
        width,
        height,
        locked,
        fit,
        upscale_method,
        snap_to,
        image=None,
        custom_aspect_width=1,
        custom_aspect_height=1,
        pad_color="black",
    ):
        if image is None:
            original_width = width if width > 0 else 1024
            original_height = height if height > 0 else 1024
        else:
            _, original_height, original_width, _ = image.shape

        target_width, target_height, aspect_label = _target_size(
            original_width,
            original_height,
            aspect_ratio,
            width,
            height,
            locked,
            custom_aspect_width,
            custom_aspect_height,
            snap_to,
        )

        if image is None:
            empty = torch.zeros((1, target_height, target_width, 3), dtype=torch.float32)
            return (empty, target_width, target_height, aspect_label, 0, 0)

        if target_width == original_width and target_height == original_height:
            return (image, target_width, target_height, aspect_label, original_width, original_height)

        samples = image.movedim(-1, 1)

        if fit == "stretch":
            resized = comfy.utils.common_upscale(samples, target_width, target_height, upscale_method, "disabled")
            return (resized.movedim(1, -1), target_width, target_height, aspect_label, original_width, original_height)

        scale_w = target_width / original_width
        scale_h = target_height / original_height
        scale = max(scale_w, scale_h) if fit == "crop" else min(scale_w, scale_h)
        resize_width = max(1, int(round(original_width * scale)))
        resize_height = max(1, int(round(original_height * scale)))

        resized = comfy.utils.common_upscale(samples, resize_width, resize_height, upscale_method, "disabled")

        if fit == "contain":
            return (resized.movedim(1, -1), target_width, target_height, aspect_label, original_width, original_height)

        if fit == "crop":
            if resize_width > target_width:
                x = (resize_width - target_width) // 2
                resized = resized.narrow(-1, x, target_width)
            if resize_height > target_height:
                y = (resize_height - target_height) // 2
                resized = resized.narrow(-2, y, target_height)
            return (resized.movedim(1, -1), target_width, target_height, aspect_label, original_width, original_height)

        pad_value = 1.0 if pad_color == "white" else 0.0
        batch, channels, resized_height, resized_width = resized.shape
        if resized_width > target_width:
            x_crop = (resized_width - target_width) // 2
            resized = resized.narrow(-1, x_crop, target_width)
        if resized_height > target_height:
            y_crop = (resized_height - target_height) // 2
            resized = resized.narrow(-2, y_crop, target_height)

        batch, channels, resized_height, resized_width = resized.shape
        padded = torch.full(
            (batch, channels, target_height, target_width),
            pad_value,
            dtype=image.dtype,
            device=image.device,
        )
        x = max(0, (target_width - resized_width) // 2)
        y = max(0, (target_height - resized_height) // 2)
        padded[:, :, y:y + resized_height, x:x + resized_width] = resized
        return (padded.movedim(1, -1), target_width, target_height, aspect_label, original_width, original_height)


NODE_CLASS_MAPPINGS = {
    "SmartAspectResize": SmartAspectResize,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SmartAspectResize": "Smart Aspect Resize",
}
