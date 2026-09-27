// Confidence policy (handoff §9): never reject a picture for a few weak joints; weak bones are
// applied gently or kept as they are, and the dock shows which.
(function (ARP) {
  'use strict';
  const { BONE_EVIDENCE, CONF, LM_NAMES } = ARP.constants;

  const boneConfidence = (conf, bone) => Math.min(...BONE_EVIDENCE[bone].map((n) => conf[n] ?? 0));

  /** 'sure' | 'unsure' | 'weak' */
  const tier = (c) => (c >= CONF.HIGH ? 'sure' : c >= CONF.LOW ? 'unsure' : 'weak');

  /**
   * How much of the picture's direction to use for a bone: 1 when sure, easing from 0.5 to 1
   * across the unsure band (the picture is usually still roughly right there), 0 = keep the
   * skeleton's current direction.
   */
  function applyWeight(c) {
    if (c >= CONF.HIGH) return 1;
    if (c < CONF.LOW) return 0;
    return 0.5 + 0.5 * ((c - CONF.LOW) / (CONF.HIGH - CONF.LOW));
  }

  /**
   * Torso: both shoulders are required; the hips are wanted but a waist-up portrait may not have
   * them, in which case the shoulder line orients the body instead of the hip line.
   */
  function torsoConfidence(conf) {
    const shoulders = Math.min(conf.leftShoulder, conf.rightShoulder);
    const hips = Math.min(conf.leftHip, conf.rightHip);
    const useHips = hips >= CONF.LOW;
    return { conf: useHips ? Math.min(shoulders, (shoulders + hips) / 2) : shoulders * 0.9, shoulders, hips, useHips };
  }

  function reliableCount(conf) {
    return LM_NAMES.filter((n) => conf[n] >= CONF.HIGH).length;
  }

  ARP.confidence = { boneConfidence, tier, applyWeight, torsoConfidence, reliableCount };
})((globalThis.ARP = globalThis.ARP || {}));
