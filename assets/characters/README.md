# 柳宗元 Blender 角色

The GLB reconstructed from `liu-zongyuan/part-00.bin` through `part-18.bin` is the rigged Blender model extracted without geometry changes from the approved `Liu_Blender_Preview.html` (4 October 2026, Hong Kong time).

- 3,385,532 bytes; 54,670 source triangles; eight authored animation clips.
- Used in chapter 2's recollection and chapter 9/epilogue.
- `js/liu-character.js` owns loading, independent skeleton cloning, seated dialogue, prop attachment, animation transitions, and gaze overlays.
- Loading begins after the existing authentication gate admits the game. If loading fails or exceeds eight seconds at character creation, the existing procedural person is used.
- The original procedural actors remain in `js/people.js` for other roles and fallback.
- Three.js r186 loader utilities are vendored under `lib/addons` and use the existing `lib/THREE_LICENSE`.

Validation: bundled the game with esbuild; parsed the GLB using the actual loader; exercised stand, sit, seated talk, drink, lie and return-to-standing, inspected CPU-skinned geometry and pose images. Browser/WebGL and physical mobile frame-rate validation were unavailable in the execution environment.

The 19 binary parts concatenate in numeric order to the original GLB (SHA-256 f6f06314c34637beaad4836d6c46ad7c3accfc3f738ed90b9967e0304122dc08). The loader fetches at most four parts concurrently and parses once.
