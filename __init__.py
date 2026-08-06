from .camera_angle_selector import (
    CameraAnglePromptCombine,
    CameraAngleSelector,
    QwenImageEdit2511AngleCamera,
)
from .smart_aspect_resize import SmartAspectResize

WEB_DIRECTORY = "web"

NODE_CLASS_MAPPINGS = {
    "CameraAngleSelector": CameraAngleSelector,
    "CameraAnglePromptCombine": CameraAnglePromptCombine,
    "QwenImageEdit2511AngleCamera": QwenImageEdit2511AngleCamera,
    "SmartAspectResize": SmartAspectResize,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CameraAngleSelector": "Camera Angle Selector",
    "CameraAnglePromptCombine": "Camera Angle Prompt Combine",
    "QwenImageEdit2511AngleCamera": "Qwen Image Edit 2511 Angle Camera",
    "SmartAspectResize": "Smart Aspect Resize",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
