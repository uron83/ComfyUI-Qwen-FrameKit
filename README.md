# ComfyUI Qwen FrameKit

Custom nodes for ComfyUI workflows that use Qwen image editing, camera-angle LoRAs, and aspect-aware image resizing.

## Nodes

### Qwen Image Edit 2511 Angle Camera

Applies a fixed Qwen Image Edit 2511 multiple-angles LoRA and emits a matching `<sks>` camera prompt.

Inputs:

- `model`
- `clip`
- `image`
- `azimuth`
- `elevation`
- `distance`
- `strength_model`
- `strength_clip`

Outputs:

- `model`
- `clip`
- `prompt`

The browser UI includes a 3D camera map. Drag inside the map to change azimuth/elevation, and use the mouse wheel to change distance.

Required LoRA file:

```text
ComfyUI/models/loras/qwen-image-edit-2511-multiple-angles-lora.safetensors
```

The node does not include model weights. Download the LoRA separately and place it at the path above.

### Camera Angle Prompt Combine

Combines the camera LoRA prompt with an edit prompt.

### Camera Angle Selector

Legacy multi-angle selector that outputs selected camera prompts.

### Smart Aspect Resize

Resizes an image while controlling aspect ratio, width, and height.

Inputs:

- `image`
- `aspect_ratio`: `from image`, `custom`, or a preset ratio
- `width`
- `height`
- `locked`: `aspect_ratio`, `width`, or `height`
- `fit`: `contain`, `crop`, `pad`, or `stretch`
- `upscale_method`
- `snap_to`
- `custom_aspect_width`
- `custom_aspect_height`
- `pad_color`

Outputs:

- `image`
- `width`
- `height`
- `aspect_ratio`
- `original_width`
- `original_height`

When `aspect_ratio` is `from image`, the frontend reads the connected `LoadImage` dimensions when available so changing width or height updates the other side from the source image ratio.

## Install

Clone this repository into your ComfyUI `custom_nodes` folder:

```powershell
cd C:\Temp\ComfyUI\custom_nodes
git clone https://github.com/uron83/ComfyUI-Qwen-FrameKit.git
```

Restart ComfyUI and hard refresh the browser.

## Notes

- The fixed camera LoRA is intentionally not stored in this repo.
- `Smart Aspect Resize` uses ComfyUI and PyTorch APIs already available in a normal ComfyUI install.
- No extra Python packages are required.
