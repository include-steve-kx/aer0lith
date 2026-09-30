// One vector target serves wing sheets, flames, and the expanding scan membrane.
// RG stores signed displacement (128 is neutral), B dispersion, A sheen + validity.
export const refractionOutput = `
  uniform float uRefraction, uDispersion, uSheen;
  vec4 glassVector(vec3 n, float coverage, float grazing) {
    vec2 offset = n.xy * coverage * (uRefraction / 3.0);
    float split = coverage * uDispersion * (0.3 + 0.7 * grazing);
    float sheen = coverage * uSheen * (0.3 + 0.7 * grazing);
    return vec4(vec2(128.0 / 255.0) + offset * (127.0 / 255.0),
      split, (1.0 + sheen * 254.0) / 255.0);
  }
`;
