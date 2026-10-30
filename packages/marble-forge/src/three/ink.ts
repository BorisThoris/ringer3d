import * as THREE from 'three';

/** The ink. */
export const INK = '#17121f';

const inkMats = new Map<number, THREE.ShaderMaterial>();
/** Back-face hull pushed out along the normal by `width` world units. */
export function inkMaterial(width: number): THREE.ShaderMaterial {
  const key = Math.round(width * 1000);
  let m = inkMats.get(key);
  if (m) return m;
  m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    // Ink fades into the fog with everything else, so it needs the fog uniforms too.
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { width: { value: width }, color: { value: new THREE.Color(INK) } }]),
    vertexShader: `
      uniform float width;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        // Push out in world space so the line is the same width at any object scale.
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
        #endif
        vec4 wp = m * vec4(position, 1.0);
        vec3 wn = normalize(mat3(m) * normal);
        wp.xyz += wn * width;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 color;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
  });
  inkMats.set(key, m);
  return m;
}
