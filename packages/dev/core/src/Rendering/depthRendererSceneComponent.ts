import type { Nullable } from "../types";
import { Scene } from "../scene";
import type { SmartArrayNoDuplicate } from "../Misc/smartArray";
import { DepthRenderer } from "./depthRenderer";
import type { Camera } from "../Cameras/camera";
import { Constants } from "../Engines/constants";
import type { ISceneComponent } from "../sceneComponent";
import { SceneComponentConstants } from "../sceneComponent";
import type { RenderTargetTexture } from "../Materials/Textures/renderTargetTexture";

declare module "../scene" {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    export interface Scene {
        /** @internal (Backing field) */
        _depthRenderer: { [id: string]: DepthRenderer };

        /**
         * Creates a depth renderer a given camera which contains a depth map which can be used for post processing.
         * @param camera The camera to create the depth renderer on (default: scene's active camera)
         * @param storeNonLinearDepth Defines whether the depth is stored linearly like in Babylon Shadows or directly like glFragCoord.z
         * @param force32bitsFloat Forces 32 bits float when supported (else 16 bits float is prioritized over 32 bits float if supported)
         * @param samplingMode The sampling mode to be used with the render target (Linear, Nearest...)
         * @param storeCameraSpaceZ Defines whether the depth stored is the Z coordinate in camera space. If true, storeNonLinearDepth has no effect. (Default: false)
         * @returns the created depth renderer
         */
        enableDepthRenderer(
            camera?: Nullable<Camera>,
            storeNonLinearDepth?: boolean,
            force32bitsFloat?: boolean,
            samplingMode?: number,
            storeCameraSpaceZ?: boolean
        ): DepthRenderer;

        /**
         * Disables a depth renderer for a given camera
         * @param camera The camera to disable the depth renderer on (default: scene's active camera)
         */
        disableDepthRenderer(camera?: Nullable<Camera>): void;
    }
}

Scene.prototype.enableDepthRenderer = function (
    camera?: Nullable<Camera>,
    storeNonLinearDepth = false,
    force32bitsFloat: boolean = false,
    samplingMode = Constants.TEXTURE_TRILINEAR_SAMPLINGMODE,
    storeCameraSpaceZ: boolean = false
): DepthRenderer {
    camera = camera || this.activeCamera;
    if (!camera) {
        // eslint-disable-next-line no-throw-literal
        throw "No camera available to enable depth renderer";
    }
    if (!this._depthRenderer) {
        this._depthRenderer = {};
    }
    if (!this._depthRenderer[camera.id]) {
        const supportFullfloat = !!this.getEngine().getCaps().textureFloatRender;
        let textureType = 0;
        if (this.getEngine().getCaps().textureHalfFloatRender && (!force32bitsFloat || !supportFullfloat)) {
            textureType = Constants.TEXTURETYPE_HALF_FLOAT;
        } else if (supportFullfloat) {
            textureType = Constants.TEXTURETYPE_FLOAT;
        } else {
            textureType = Constants.TEXTURETYPE_UNSIGNED_BYTE;
        }
        this._depthRenderer[camera.id] = new DepthRenderer(this, textureType, camera, storeNonLinearDepth, samplingMode, storeCameraSpaceZ);
    }

    return this._depthRenderer[camera.id];
};

Scene.prototype.disableDepthRenderer = function (camera?: Nullable<Camera>): void {
    camera = camera || this.activeCamera;
    if (!camera || !this._depthRenderer || !this._depthRenderer[camera.id]) {
        return;
    }

    this._depthRenderer[camera.id].dispose();
};

/**
 * Defines the Depth Renderer scene component responsible to manage a depth buffer useful
 * in several rendering techniques.
 */
export class DepthRendererSceneComponent implements ISceneComponent {
    /**
     * The component name helpful to identify the component in the list of scene components.
     */
    public readonly name = SceneComponentConstants.NAME_DEPTHRENDERER;

    /**
     * The scene the component belongs to.
     */
    public scene: Scene;

    /**
     * Creates a new instance of the component for the given scene
     * @param scene Defines the scene to register the component in
     */
    constructor(scene: Scene) {
        this.scene = scene;
    }

    /**
     * Registers the component in a given scene
     */
    public register(): void {
        this.scene._gatherRenderTargetsStage.registerStep(SceneComponentConstants.STEP_GATHERRENDERTARGETS_DEPTHRENDERER, this, this._gatherRenderTargets);
        this.scene._gatherActiveCameraRenderTargetsStage.registerStep(
            SceneComponentConstants.STEP_GATHERACTIVECAMERARENDERTARGETS_DEPTHRENDERER,
            this,
            this._gatherActiveCameraRenderTargets
        );
    }

    /**
     * Rebuilds the elements related to this component in case of
     * context lost for instance.
     */
    public rebuild(): void {
        // Nothing to do for this component
    }

    /**
     * Disposes the component and the associated resources
     */
    public dispose(): void {
        for (const key in this.scene._depthRenderer) {
            this.scene._depthRenderer[key].dispose();
        }
    }

    private _gatherRenderTargets(renderTargets: SmartArrayNoDuplicate<RenderTargetTexture>): void {
        if (this.scene._depthRenderer) {
            for (const key in this.scene._depthRenderer) {
                const depthRenderer = this.scene._depthRenderer[key];
                if (depthRenderer.enabled && !depthRenderer.useOnlyInActiveCamera) {
                    renderTargets.push(depthRenderer.getDepthMap());
                }
            }
        }
    }

    private _gatherActiveCameraRenderTargets(renderTargets: SmartArrayNoDuplicate<RenderTargetTexture>): void {
        if (this.scene._depthRenderer) {
            for (const key in this.scene._depthRenderer) {
                const depthRenderer = this.scene._depthRenderer[key];
                if (depthRenderer.enabled && depthRenderer.useOnlyInActiveCamera && this.scene.activeCamera!.id === key) {
                    renderTargets.push(depthRenderer.getDepthMap());
                }
            }
        }
    }
}

DepthRenderer._SceneComponentInitialization = (scene: Scene) => {
    // Register the G Buffer component to the scene.
    let component = scene._getComponent(SceneComponentConstants.NAME_DEPTHRENDERER) as DepthRendererSceneComponent;
    if (!component) {
        component = new DepthRendererSceneComponent(scene);
        scene._addComponent(component);
    }
};
