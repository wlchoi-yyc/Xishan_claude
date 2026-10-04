import { Quaternion, Vector3 } from '../lib/three.module.js';

// The authored seated clips rotate the thighs but leave the ankles rigid.
// Keep the existing shoes, turning their soles down as the seated drape blends in.
export function createLiuFootPose(actor) {
  actor.updateWorldMatrix(true, true);
  const actorQ = actor.getWorldQuaternion(new Quaternion());
  const feet = ['FootL', 'FootR'].map(name => {
    const bone = actor.getObjectByName(name);
    return {
      bone,
      rest: actorQ.clone().invert().multiply(bone.getWorldQuaternion(new Quaternion())),
      rotation: bone.quaternion.clone(),
      position: bone.position.clone(),
    };
  });
  let robe;
  actor.traverse(o => {
    if (o.name === 'Liu_IndigoLinen' && o.morphTargetDictionary?.SeatedDrape !== undefined) robe = o;
  });
  const q = new Quaternion(), parentQ = new Quaternion(), desired = new Quaternion();
  const point = new Vector3();
  return {
    restore() {
      for (const f of feet) {
        f.bone.quaternion.copy(f.rotation);
        f.bone.position.copy(f.position);
      }
    },
    apply() {
      const k = robe ? robe.morphTargetInfluences[robe.morphTargetDictionary.SeatedDrape] : 0;
      actor.updateWorldMatrix(true, true);
      actor.getWorldQuaternion(actorQ);
      for (const f of feet) {
        const b = f.bone;
        f.rotation.copy(b.quaternion);
        f.position.copy(b.position);
        if (k < 0.0001) continue;
        b.getWorldQuaternion(q);
        desired.copy(actorQ).multiply(f.rest);
        q.slerp(desired, k);
        b.parent.getWorldQuaternion(parentQ).invert();
        b.quaternion.copy(parentQ.multiply(q));
        // Tuck the ankles under the hem, with the sole just above ground.
        b.getWorldPosition(point);
        actor.worldToLocal(point);
        point.y -= 0.0223 * k;
        point.z -= 0.12 * k;
        actor.localToWorld(point);
        b.position.copy(b.parent.worldToLocal(point));
        b.updateWorldMatrix(false, false);
      }
    },
  };
}
