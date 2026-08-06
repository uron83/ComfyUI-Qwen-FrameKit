import { app } from "../../scripts/app.js";

const RATIOS = {
  "1:1": [1, 1],
  "2:3": [2, 3],
  "3:2": [3, 2],
  "3:4": [3, 4],
  "4:3": [4, 3],
  "4:5": [4, 5],
  "5:4": [5, 4],
  "9:16": [9, 16],
  "16:9": [16, 9],
  "21:9": [21, 9],
};

function widget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

function numberValue(node, name, fallback) {
  const value = Number(widget(node, name)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function currentWidgetRatio(node) {
  const width = Math.max(1, numberValue(node, "width", 1024));
  const height = Math.max(1, numberValue(node, "height", 1024));
  return width / height;
}

function linkedPreviewUrl(node) {
  const input = node.inputs?.find((i) => i.name === "image");
  if (!input?.link || !app.graph?.links) return null;

  const link = app.graph.links[input.link];
  const originId = Array.isArray(link) ? link[1] : link?.origin_id;
  if (originId == null) return null;

  const origin = app.graph.getNodeById ? app.graph.getNodeById(originId) : app.graph._nodes_by_id?.[originId];
  if (!origin || origin.type !== "LoadImage") return null;

  const imageWidget = origin.widgets?.find((w) => w.name === "image");
  let filename = imageWidget?.value || origin.widgets_values?.[0];
  if (!filename || typeof filename !== "string") return null;

  let type = "input";
  const match = filename.match(/\s+\[(input|output|temp)\]$/);
  if (match) {
    type = match[1];
    filename = filename.replace(/\s+\[(input|output|temp)\]$/, "");
  }

  return `/view?filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(type)}&subfolder=`;
}

function loadImageSize(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = url;
  });
}

async function refreshSourceImageRatio(node, changedName = "width") {
  if (widget(node, "aspect_ratio")?.value !== "from image") return false;

  const url = linkedPreviewUrl(node);
  if (!url || url === node.__smartAspectSourceUrl) return false;

  node.__smartAspectSourceUrl = url;
  try {
    const size = await loadImageSize(url);
    if (!size.width || !size.height) return false;
    node.__smartAspectSourceWidth = size.width;
    node.__smartAspectSourceHeight = size.height;
    node.__smartAspectBaseRatio = size.width / size.height;
    updateSize(node, changedName);
    return true;
  } catch (error) {
    console.warn("SmartAspectResize: unable to read linked image size", error);
    return false;
  }
}

function snap(value, snapTo) {
  const size = Math.max(1, Math.round(value));
  const multiple = Math.max(1, Math.round(snapTo || 1));
  if (multiple <= 1) return size;
  return Math.max(multiple, Math.round(size / multiple) * multiple);
}

function ratioForNode(node) {
  const ratioName = widget(node, "aspect_ratio")?.value || "1:1";
  if (ratioName === "custom") {
    return Math.max(1, numberValue(node, "custom_aspect_width", 1)) /
      Math.max(1, numberValue(node, "custom_aspect_height", 1));
  }

  if (ratioName === "from image") {
    if (!Number.isFinite(node.__smartAspectBaseRatio) || node.__smartAspectBaseRatio <= 0) {
      node.__smartAspectBaseRatio = node.__smartAspectSourceWidth && node.__smartAspectSourceHeight
        ? node.__smartAspectSourceWidth / node.__smartAspectSourceHeight
        : currentWidgetRatio(node);
    }
    return node.__smartAspectBaseRatio;
  }

  const pair = RATIOS[ratioName] || RATIOS["1:1"];
  return pair[0] / pair[1];
}

function setWidgetValue(node, name, value) {
  const w = widget(node, name);
  if (!w) return;
  w.value = value;
}

function updateSize(node, changedName) {
  if (node.__smartAspectUpdating) return;
  node.__smartAspectUpdating = true;

  try {
    if (changedName === "aspect_ratio" && widget(node, "aspect_ratio")?.value === "from image") {
      refreshSourceImageRatio(node, "width");
    }

    const locked = widget(node, "locked")?.value || "aspect_ratio";
    const ratio = ratioForNode(node);
    const snapTo = numberValue(node, "snap_to", 8);
    const width = Math.max(1, numberValue(node, "width", 1024));
    const height = Math.max(1, numberValue(node, "height", 1024));

    if (locked === "width") {
      setWidgetValue(node, "height", snap(width / ratio, snapTo));
    } else if (locked === "height") {
      setWidgetValue(node, "width", snap(height * ratio, snapTo));
    } else if (changedName === "height") {
      setWidgetValue(node, "width", snap(height * ratio, snapTo));
    } else {
      setWidgetValue(node, "height", snap(width / ratio, snapTo));
    }

    app.canvas?.setDirty?.(true, true);
  } finally {
    node.__smartAspectUpdating = false;
  }
}

app.registerExtension({
  name: "Comfy.SmartAspectResize",

  async nodeCreated(node) {
    if (node.comfyClass !== "SmartAspectResize") return;

    node.__smartAspectBaseRatio = currentWidgetRatio(node);

    for (const name of ["aspect_ratio", "width", "height", "locked", "custom_aspect_width", "custom_aspect_height", "snap_to"]) {
      const w = widget(node, name);
      if (!w) continue;
      const original = w.callback;
      w.callback = function(value) {
        original?.call(this, value);
        if (name === "aspect_ratio" || name === "width" || name === "height") {
          refreshSourceImageRatio(node, name);
        }
        updateSize(node, name);
      };
    }

    refreshSourceImageRatio(node, "width");
    updateSize(node, "width");
  },
});
