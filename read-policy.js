"use strict";

// Pure classification of supplied values; no DOM, browser state or notifications.
(() => {
  const READ_ICON_RE = /^(?:msg|status)-dblcheck-ack(?:-light)?$/i;
  const OUTGOING_STATUS_RE = /^(?:msg|status)-(?:clock|check|dblcheck|dblcheck-ack|dblcheck-ack-light)$/i;
  const READ_LABEL_RE = /\b(?:read|letto|letta|letti|lette|lu|lue|lus|lues|le[ií]do|le[ií]da|gelesen)\b/i;

  function normalizeLabel(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sameLabel(a, b) {
    return normalizeLabel(a).toLocaleLowerCase() === normalizeLabel(b).toLocaleLowerCase();
  }

  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function parseRgb(value) {
    const match = String(value || "").match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!match) {
      return null;
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }

  function isWhatsAppReadBlue(value) {
    const rgb = parseRgb(value);
    if (!rgb) {
      return false;
    }
    const [red, green, blue] = rgb;
    return red < 145 && green > 135 && blue > 175 && blue > green && green > red + 25;
  }

  function isReadIcon(value) { return READ_ICON_RE.test(value); }
  function isOutgoingStatusIcon(value) { return OUTGOING_STATUS_RE.test(value); }
  function isReadLabel(value) { return READ_LABEL_RE.test(value); }

  const policy = Object.freeze({ normalizeLabel, sameLabel, fnv1a, isWhatsAppReadBlue, isReadIcon, isOutgoingStatusIcon, isReadLabel });
  globalThis.WhatsAppReadPolicy = policy;
  if (typeof module === "object" && module.exports) module.exports = policy;
})();
