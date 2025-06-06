import { VRDeviceOrientationFreeCamera } from "./vrDeviceOrientationFreeCamera";
import { VRCameraMetrics } from "./vrCameraMetrics";
import type { Scene } from "../../scene";
import { Vector3 } from "../../Maths/math.vector";
import { Node } from "../../node";
import { _SetVrRigMode } from "../RigModes/vrRigMode";

import "../../Gamepads/gamepadSceneComponent";

Node.AddNodeConstructor("VRDeviceOrientationGamepadCamera", (name, scene) => {
    return () => new VRDeviceOrientationGamepadCamera(name, Vector3.Zero(), scene);
});

/**
 * Camera used to simulate VR rendering (based on VRDeviceOrientationFreeCamera)
 * @see https://doc.babylonjs.com/features/featuresDeepDive/cameras/camera_introduction#vr-device-orientation-cameras
 */
export class VRDeviceOrientationGamepadCamera extends VRDeviceOrientationFreeCamera {
    /**
     * Creates a new VRDeviceOrientationGamepadCamera
     * @param name defines camera name
     * @param position defines the start position of the camera
     * @param scene defines the scene the camera belongs to
     * @param compensateDistortion defines if the camera needs to compensate the lens distortion
     * @param vrCameraMetrics defines the vr metrics associated to the camera
     */
    constructor(name: string, position: Vector3, scene?: Scene, compensateDistortion = true, vrCameraMetrics: VRCameraMetrics = VRCameraMetrics.GetDefault()) {
        super(name, position, scene, compensateDistortion, vrCameraMetrics);

        this.inputs.addGamepad();
    }

    /**
     * Gets camera class name
     * @returns VRDeviceOrientationGamepadCamera
     */
    public override getClassName(): string {
        return "VRDeviceOrientationGamepadCamera";
    }

    protected override _setRigMode = (rigParams: any) => _SetVrRigMode(this, rigParams);
}
