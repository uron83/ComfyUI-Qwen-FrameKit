"""
Camera Angle Selector Node for ComfyUI
A custom node that provides a 3D visual interface for selecting camera angles.
The 3D visualization renders directly inside the node using Three.js.
"""

import json
import os
import shutil
import urllib.error
import urllib.request

import comfy.sd
import comfy.utils
import folder_paths

# View directions (8 angles)
VIEW_DIRECTIONS = [
    "front view",
    "front-right quarter view",
    "right side view",
    "back-right quarter view",
    "back view",
    "back-left quarter view",
    "left side view",
    "front-left quarter view",
]

# Height angles (4 types)
HEIGHT_ANGLES = [
    "low-angle shot",
    "eye-level shot",
    "elevated shot",
    "high-angle shot",
]

# Shot sizes (3 types)
SHOT_SIZES = [
    "close-up",
    "medium shot",
    "wide shot",
]

AZIMUTH_MAP = {
    0: "front view",
    45: "front-right quarter view",
    90: "right side view",
    135: "back-right quarter view",
    180: "back view",
    225: "back-left quarter view",
    270: "left side view",
    315: "front-left quarter view",
}

ELEVATION_MAP = {
    -30: "low-angle shot",
    0: "eye-level shot",
    30: "elevated shot",
    60: "high-angle shot",
}

DISTANCE_MAP = {
    0.6: "close-up",
    1.0: "medium shot",
    1.8: "wide shot",
}

ANGLE_LORA_NAME = "qwen-image-edit-2511-multiple-angles-lora.safetensors"
ANGLE_LORA_REPO = "fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA"
ANGLE_LORA_URLS = [
    f"https://huggingface.co/{ANGLE_LORA_REPO}/resolve/main/{ANGLE_LORA_NAME}?download=true",
]
ANGLE_LORA_MODEL_PAGE = f"https://huggingface.co/{ANGLE_LORA_REPO}"

# Generate all 96 combinations
CAMERA_ANGLES = []
for direction in VIEW_DIRECTIONS:
    for height in HEIGHT_ANGLES:
        for size in SHOT_SIZES:
            CAMERA_ANGLES.append({
                "direction": direction,
                "height": height,
                "size": size,
                "prompt": f"<sks> {direction} {height} {size}"
            })


class CameraAngleSelector:
    """
    ComfyUI custom node for selecting camera angles using a 3D visual interface.
    The 3D visualization is rendered by the companion JavaScript extension.
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "selected_indices": ("STRING", {
                    "default": "[]",
                    "multiline": False,
                }),
            },
        }
    
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("selected_angles",)
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "execute"
    CATEGORY = "camera"
    DESCRIPTION = "Select camera angles using a 3D visual interface rendered directly in the node"
    
    def execute(self, selected_indices="[]"):
        """
        Execute the node and return the list of selected prompts.
        
        Args:
            selected_indices: JSON string containing list of selected indices
            
        Returns:
            Tuple containing list of selected angle prompts
        """
        # Parse selected indices
        try:
            indices = json.loads(selected_indices)
        except (json.JSONDecodeError, TypeError):
            indices = []
        
        if not isinstance(indices, list):
            indices = []
        
        # Clamp indices to valid range
        clamped_indices = []
        for idx in indices:
            if isinstance(idx, int):
                clamped_indices.append(max(0, min(idx, len(CAMERA_ANGLES) - 1)))
        
        # Build <sks> ... prompts from clamped indices
        selected_prompts = []
        for idx in clamped_indices:
            selected_prompts.append(CAMERA_ANGLES[idx]["prompt"])
        
        return (selected_prompts,)


class CameraAnglePromptCombine:
    """
    Combine a camera-angle LoRA trigger prompt with the normal edit instruction.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "camera_prompt": ("STRING", {
                    "default": "",
                    "multiline": False,
                }),
                "edit_prompt": ("STRING", {
                    "default": "Edit the image while preserving identity, pose, and composition.",
                    "multiline": True,
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "execute"
    CATEGORY = "camera"
    DESCRIPTION = "Prepends a Qwen multi-angle LoRA camera prompt to an edit prompt"

    def execute(self, camera_prompt, edit_prompt):
        camera_prompt = (camera_prompt or "").strip()
        edit_prompt = (edit_prompt or "").strip()

        if camera_prompt and edit_prompt:
            prompt = f"{camera_prompt}\n{edit_prompt}"
        else:
            prompt = camera_prompt or edit_prompt

        return (prompt,)


def _lora_missing_message():
    return (
        f"Missing required LoRA: {ANGLE_LORA_NAME}\n"
        f"Expected location: ComfyUI/models/loras/{ANGLE_LORA_NAME}\n"
        f"Download page: {ANGLE_LORA_MODEL_PAGE}"
    )


def _configured_lora_paths():
    if hasattr(folder_paths, "get_folder_paths"):
        try:
            paths = folder_paths.get_folder_paths("loras")
            if paths:
                return paths
        except Exception:
            pass

    folder_config = getattr(folder_paths, "folder_names_and_paths", {}).get("loras")
    if folder_config:
        paths = folder_config[0]
        if paths:
            return paths

    models_dir = getattr(folder_paths, "models_dir", None)
    if models_dir:
        return [os.path.join(models_dir, "loras")]

    return []


def _find_angle_lora():
    if hasattr(folder_paths, "get_full_path"):
        lora_path = folder_paths.get_full_path("loras", ANGLE_LORA_NAME)
        if lora_path:
            return lora_path

    try:
        return folder_paths.get_full_path_or_raise("loras", ANGLE_LORA_NAME)
    except Exception:
        return None


def _download_angle_lora():
    lora_paths = _configured_lora_paths()
    if not lora_paths:
        raise RuntimeError(f"{_lora_missing_message()}\nCould not find a configured ComfyUI loras folder.")

    destination = os.path.join(lora_paths[0], ANGLE_LORA_NAME)
    if os.path.exists(destination):
        return destination

    os.makedirs(os.path.dirname(destination), exist_ok=True)
    temporary_path = destination + ".download"
    if os.path.exists(temporary_path):
        os.remove(temporary_path)

    last_error = None
    for url in ANGLE_LORA_URLS:
        try:
            print(f"FrameKit: downloading {ANGLE_LORA_NAME} from {ANGLE_LORA_MODEL_PAGE}")
            request = urllib.request.Request(url, headers={"User-Agent": "ComfyUI-Qwen-FrameKit"})
            with urllib.request.urlopen(request) as response, open(temporary_path, "wb") as output:
                shutil.copyfileobj(response, output)
            os.replace(temporary_path, destination)
            print(f"FrameKit: downloaded {ANGLE_LORA_NAME} to {destination}")
            return destination
        except (OSError, urllib.error.URLError, urllib.error.HTTPError) as error:
            last_error = error
            if os.path.exists(temporary_path):
                os.remove(temporary_path)

    raise RuntimeError(f"{_lora_missing_message()}\nAutomatic download failed: {last_error}")


def _get_or_download_angle_lora(auto_download_lora):
    lora_path = _find_angle_lora()
    if lora_path:
        return lora_path

    if auto_download_lora:
        return _download_angle_lora()

    raise FileNotFoundError(_lora_missing_message())


class QwenImageEdit2511AngleCamera:
    """
    Single-camera control for Qwen-Image-Edit-2511 Multiple Angles LoRA.
    Applies the fixed LoRA and outputs only the formatted <sks> camera prompt.
    """

    def __init__(self):
        self.loaded_lora = None

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "image": ("IMAGE",),
                "azimuth": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 315.0, "step": 45.0}),
                "elevation": ("FLOAT", {"default": 0.0, "min": -30.0, "max": 60.0, "step": 30.0}),
                "distance": ("FLOAT", {"default": 1.0, "min": 0.6, "max": 1.8, "step": 0.4}),
                "strength_model": ("FLOAT", {"default": 1.0, "min": -5.0, "max": 5.0, "step": 0.05}),
                "strength_clip": ("FLOAT", {"default": 1.0, "min": -5.0, "max": 5.0, "step": 0.05}),
                "auto_download_lora": ("BOOLEAN", {"default": True}),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("model", "clip", "prompt")
    FUNCTION = "execute"
    CATEGORY = "camera"
    DESCRIPTION = "Single-camera control that applies the fixed Qwen-Image-Edit-2511 Multiple Angles LoRA and emits its <sks> prompt"

    @staticmethod
    def snap_to_nearest(value, options):
        best = options[0]
        best_distance = abs(best - value)
        for option in options[1:]:
            distance = abs(option - value)
            if distance < best_distance or (abs(distance - best_distance) <= 1e-9 and option > best):
                best = option
                best_distance = distance
        return best

    @classmethod
    def build_camera_prompt(cls, azimuth, elevation, distance):
        azimuth = cls.snap_to_nearest(float(azimuth) % 360, list(AZIMUTH_MAP.keys()))
        elevation = cls.snap_to_nearest(float(elevation), list(ELEVATION_MAP.keys()))
        distance = cls.snap_to_nearest(float(distance), list(DISTANCE_MAP.keys()))
        return f"<sks> {AZIMUTH_MAP[azimuth]} {ELEVATION_MAP[elevation]} {DISTANCE_MAP[distance]}"

    def load_fixed_lora(self, model, clip, strength_model, strength_clip, auto_download_lora):
        if strength_model == 0 and strength_clip == 0:
            return model, clip

        lora_path = _get_or_download_angle_lora(auto_download_lora)
        lora = None
        lora_metadata = None
        if self.loaded_lora is not None:
            if self.loaded_lora[0] == lora_path:
                lora = self.loaded_lora[1]
                lora_metadata = self.loaded_lora[2] if len(self.loaded_lora) > 2 else None
            else:
                self.loaded_lora = None

        if lora is None:
            lora, lora_metadata = comfy.utils.load_torch_file(lora_path, safe_load=True, return_metadata=True)
            self.loaded_lora = (lora_path, lora, lora_metadata)

        return comfy.sd.load_lora_for_models(
            model,
            clip,
            lora,
            strength_model,
            strength_clip,
            lora_metadata=lora_metadata,
        )

    def execute(
        self,
        model,
        clip,
        image,
        azimuth,
        elevation,
        distance,
        strength_model,
        strength_clip,
        auto_download_lora=True,
    ):
        model_lora, clip_lora = self.load_fixed_lora(model, clip, strength_model, strength_clip, auto_download_lora)
        camera_prompt = ""
        if strength_model != 0 or strength_clip != 0:
            camera_prompt = self.build_camera_prompt(azimuth, elevation, distance)
        return model_lora, clip_lora, camera_prompt


NODE_CLASS_MAPPINGS = {
    "CameraAngleSelector": CameraAngleSelector,
    "CameraAnglePromptCombine": CameraAnglePromptCombine,
    "QwenImageEdit2511AngleCamera": QwenImageEdit2511AngleCamera,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CameraAngleSelector": "Camera Angle Selector",
    "CameraAnglePromptCombine": "Camera Angle Prompt Combine",
    "QwenImageEdit2511AngleCamera": "Qwen Image Edit 2511 Angle Camera",
}
