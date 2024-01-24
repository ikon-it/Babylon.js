import { WebXRExperienceHelper } from "./webXRExperienceHelper";
import type { Scene } from "../scene";
import type { IWebXRInputOptions } from "./webXRInput";
import { WebXRInput } from "./webXRInput";
import type { IWebXRControllerPointerSelectionOptions } from "./features/WebXRControllerPointerSelection";
import { WebXRControllerPointerSelection } from "./features/WebXRControllerPointerSelection";
import type { IWebXRNearInteractionOptions } from "./features/WebXRNearInteraction";
import { WebXRNearInteraction } from "./features/WebXRNearInteraction";
import type { WebXRRenderTarget } from "./webXRTypes";
import type { WebXREnterExitUIOptions } from "./webXREnterExitUI";
import { WebXREnterExitUI } from "./webXREnterExitUI";
import type { AbstractMesh } from "../Meshes/abstractMesh";
import type { WebXRManagedOutputCanvasOptions } from "./webXRManagedOutputCanvas";
import type { IWebXRTeleportationOptions } from "./features/WebXRControllerTeleportation";
import { WebXRMotionControllerTeleportation } from "./features/WebXRControllerTeleportation";
import { Logger } from "../Misc/logger";
import type { Engine } from "../Engines/engine";

/**
 * Options for the default xr helper
 */
export class WebXRDefaultExperienceOptions {
    /**
     * Enable or disable default UI to enter XR
     */
    public disableDefaultUI?: boolean;
    /**
     * Should pointer selection not initialize.
     * Note that disabling pointer selection also disables teleportation.
     * Defaults to false.
     */
    public disablePointerSelection?: boolean;
    /**
     * Should teleportation not initialize. Defaults to false.
     */
    public disableTeleportation?: boolean;
    /**
     * Should nearInteraction not initialize. Defaults to false.
     */
    public disableNearInteraction?: boolean;
    /**
     * Floor meshes that will be used for teleport
     */
    public floorMeshes?: Array<AbstractMesh>;
    /**
     * If set to true, the first frame will not be used to reset position
     * The first frame is mainly used when copying transformation from the old camera
     * Mainly used in AR
     */
    public ignoreNativeCameraTransformation?: boolean;
    /**
     * Optional configuration for the XR input object
     */
    public inputOptions?: Partial<IWebXRInputOptions>;
    /**
     * optional configuration for pointer selection
     */
    public pointerSelectionOptions?: Partial<IWebXRControllerPointerSelectionOptions>;
    /**
     * optional configuration for near interaction
     */
    public nearInteractionOptions?: Partial<IWebXRNearInteractionOptions>;
    /**
     * optional configuration for teleportation
     */
    public teleportationOptions?: Partial<IWebXRTeleportationOptions>;
    /**
     * optional configuration for the output canvas
     */
    public outputCanvasOptions?: WebXRManagedOutputCanvasOptions;
    /**
     * optional UI options. This can be used among other to change session mode and reference space type
     */
    public uiOptions?: Partial<WebXREnterExitUIOptions>;
    /**
     * When loading teleportation and pointer select, use stable versions instead of latest.
     */
    public useStablePlugins?: boolean;

    /**
     * An optional rendering group id that will be set globally for teleportation, pointer selection and default controller meshes
     */
    public renderingGroupId?: number;

    /**
     * A list of optional features to init the session with
     * If set to true, all features we support will be added
     */
    public optionalFeatures?: boolean | string[];
}

/**
 * Default experience for webxr
 */
export class WebXRDefaultExperience {
    /**
     * The options of the experience
     */
    public options: WebXRDefaultExperienceOptions;
    /**
     * Indicates whether persistent mode is activated or not
     */
    public persistent = false;
    /**
     * Base experience
     */
    public baseExperience: WebXRExperienceHelper;
    /**
     * Enables ui for entering/exiting xr
     */
    public enterExitUI: WebXREnterExitUI;
    /**
     * Input experience extension
     */
    public input: WebXRInput;
    /**
     * Enables laser pointer and selection
     */
    public pointerSelection: WebXRControllerPointerSelection;
    /**
     * Default target xr should render to
     */
    public renderTarget: WebXRRenderTarget;
    /**
     * Enables teleportation
     */
    public teleportation: WebXRMotionControllerTeleportation;

    /**
     * Enables near interaction for hands/controllers
     */
    public nearInteraction: WebXRNearInteraction;

    private constructor() { }

    /**
     * Creates the default xr experience
     * @param scene scene
     * @param options options for basic configuration
     * @returns resulting WebXRDefaultExperience
     */
    public static CreateAsync(scene: Scene, options: WebXRDefaultExperienceOptions = {}) {
        const result = new WebXRDefaultExperience();
        result.options = options;
        scene.onDisposeObservable.addOnce(() => {
            result.dispose();
        });

        // Create base experience
        return WebXRExperienceHelper.CreateAsync(scene)
            .then((xrHelper) => {
                result.baseExperience = xrHelper;
                result._initializeScene();

                // Create the WebXR output target
                result.renderTarget = result.baseExperience.sessionManager.getWebXRRenderTarget(options.outputCanvasOptions);

                if (!options.disableDefaultUI) {
                    result._addUI(scene.getEngine());
                    // Create ui for entering/exiting xr
                    return result.enterExitUI.setHelperAsync(result.baseExperience, result.renderTarget);
                } else {
                    return;
                }
            })
            .then(() => {
                return result;
            })
            .catch((error) => {
                Logger.Error("Error initializing XR");
                Logger.Error(error);
                return result;
            });
    }

    /**
     * Creates the default xr experience for multi scene
     * @param engine
     * @param options options for basic configuration
     * @returns resulting WebXRDefaultExperience
     */
    public static CreatePersistentAsync(engine: Engine, options: WebXRDefaultExperienceOptions = {}): Promise<WebXRDefaultExperience> {
        // Add default values for persistent mode.
        if (Object.keys(options).length === 0) {
            options = {
                disableTeleportation: true,
                disableNearInteraction: true,
            };
        }

        const result = new WebXRDefaultExperience();
        result.options = options;
        result.persistent = true;

        // Create base experience, passing an engine, which also sets downstream to persistent
        return WebXRExperienceHelper.CreateAsync(engine)
            .then((xrHelper) => {
                result.baseExperience = xrHelper;

                // Create the WebXR output target
                result.renderTarget = result.baseExperience.sessionManager.getWebXRRenderTarget(result.options.outputCanvasOptions);

                if (!options.disableDefaultUI) {
                    result._addUI(engine);
                    // Create ui for entering/exiting xr
                    return result.enterExitUI.setHelperAsync(xrHelper, result.renderTarget);
                } else {
                    return;
                }
            })
            .then(() => {
                return result;
            })
            .catch((error) => {
                Logger.Error("Error initializing XR");
                Logger.Error(error);
                return result;
            });
    }

    /**
     * Broken out from CreateAsync(), so that also can be called as well from CreatePersistentAsync.
     * @param engine needed for the WebXREnterExitUI constructor
     */
    private _addUI(engine: Engine): void {
        // init the UI right after construction
        if (!this.options.disableDefaultUI) {
            const uiOptions: WebXREnterExitUIOptions = {
                renderTarget: this.renderTarget,
                ...(this.options.uiOptions || {}),
            };

            if (this.options.optionalFeatures) {
                if (typeof this.options.optionalFeatures === "boolean") {
                    uiOptions.optionalFeatures = ["hit-test", "anchors", "plane-detection", "hand-tracking"];
                } else {
                    uiOptions.optionalFeatures = this.options.optionalFeatures;
                }
            }

            this.enterExitUI = new WebXREnterExitUI(engine, uiOptions);
        }
    }

    /**
     * Broken out from CreateAsync().
     * This must be performed for every scene, so also called from moveXRToScene().
     */
    private _initializeScene(): void {
        if (this.options.ignoreNativeCameraTransformation) {
            this.baseExperience.camera.compensateOnFirstFrame = false;
        }

        // Add controller support
        this.input = new WebXRInput(this.baseExperience.sessionManager, this.baseExperience.camera, {
            controllerOptions: {
                renderingGroupId: this.options.renderingGroupId,
            },
            ...(this.options.inputOptions || {}),
        });

        if (!this.options.disablePointerSelection) {
            // Add default pointer selection
            const pointerSelectionOptions = {
                ...this.options.pointerSelectionOptions,
                xrInput: this.input,
                renderingGroupId: this.options.renderingGroupId,
            };

            this.pointerSelection = <WebXRControllerPointerSelection>(
                this.baseExperience.featuresManager.enableFeature(
                    WebXRControllerPointerSelection.Name,
                    this.options.useStablePlugins ? "stable" : "latest",
                    <IWebXRControllerPointerSelectionOptions>pointerSelectionOptions
                )
            );

            if (!this.options.disableTeleportation) {
                // added persistance check; there are no floorMeshes at the engine level
                // disabled actually means not enabled; can always be done at moveXRToScene() time
                if (this.persistent) throw 'Teleport option not suitable to define at engine level for persistent mode';

                // Add default teleportation, including rotation
                this.teleportation = <WebXRMotionControllerTeleportation>this.baseExperience.featuresManager.enableFeature(
                    WebXRMotionControllerTeleportation.Name,
                    this.options.useStablePlugins ? "stable" : "latest",
                    <IWebXRTeleportationOptions>{
                        floorMeshes: this.options.floorMeshes,
                        xrInput: this.input,
                        renderingGroupId: this.options.renderingGroupId,
                        ...this.options.teleportationOptions,
                    }
                );
                this.teleportation.setSelectionFeature(this.pointerSelection);
            }
        }

        if (!this.options.disableNearInteraction) {
            // Add default pointer selection
            this.nearInteraction = <WebXRNearInteraction>this.baseExperience.featuresManager.enableFeature(
                WebXRNearInteraction.Name,
                this.options.useStablePlugins ? "stable" : "latest",
                <IWebXRNearInteractionOptions>{
                    xrInput: this.input,
                    farInteractionFeature: this.pointerSelection,
                    renderingGroupId: this.options.renderingGroupId,
                    useUtilityLayer: true,
                    enableNearInteractionOnAllControllers: true,
                    ...this.options.nearInteractionOptions,
                }
            );
        }
    }

    /**
     * Move or initially place the scene supplied as the one operating in XR
     * @param nextScene The scene XR is being moved to
     * @param hookUp A callback, which holds all the features which need initialized
     * in the scene.
     */
    public async moveXRToScene(nextScene: Scene, hookUp: (defExperience: WebXRDefaultExperience) => void): Promise<void> {
        // sanity check
        if (!this.persistent) throw 'DefaultExperience must be instanced with CreatePersistentAsync() to move XR';

        // call a persistence aware dispose
        this.dispose(false);

        // perform creation of the next this.baseExperience.camera & this.baseExperience.featureManager
        await this.baseExperience.moveXRToScene(nextScene);

        // re-initialize for the next scene
        this._initializeScene();

        // let session manager know new scene & what features / code needs to run on SessionInit
        this.baseExperience.sessionManager.moveXRToScene(nextScene, this, hookUp);
    }

    /**
     * Disposes of the experience helper
     */
    public dispose(all: boolean = true) {
        const shouldClear = !this.persistent || all;

        if (this.baseExperience) {
            this.baseExperience.dispose(all);
        }
        if (this.input) {
            this.input.dispose();
        }
        if (this.enterExitUI && shouldClear) {
            this.enterExitUI.dispose();
        }
        if (this.renderTarget && shouldClear) {
            this.renderTarget.dispose();
        }
    }
}
