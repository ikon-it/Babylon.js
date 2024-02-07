import { Logger } from "../Misc/logger";
import type { Observer } from "../Misc/observable";
import { Observable } from "../Misc/observable";
import type { Nullable } from "../types";
import type { IDisposable } from "../scene";
import { Scene } from "../scene";
import type { RenderTargetTexture } from "../Materials/Textures/renderTargetTexture";
import type { WebXRRenderTarget } from "./webXRTypes";
import { WebXRManagedOutputCanvas, WebXRManagedOutputCanvasOptions } from "./webXRManagedOutputCanvas";
import type { Engine } from "../Engines/engine";
import type { IWebXRRenderTargetTextureProvider, WebXRLayerRenderTargetTextureProvider } from "./webXRRenderTargetTextureProvider";
import type { Viewport } from "../Maths/math.viewport";
import type { WebXRLayerWrapper } from "./webXRLayerWrapper";
import { NativeXRLayerWrapper, NativeXRRenderTarget } from "./native/nativeXRRenderTarget";
import { WebXRWebGLLayerWrapper } from "./webXRWebGLLayer";
import type { ThinEngine } from "../Engines/thinEngine";
import type { WebXRDefaultExperience } from "./webXRDefaultExperience";
import { WebXRFeatureName } from "./webXRFeaturesManager";

/**
 * Manages an XRSession to work with Babylon's engine
 * @see https://doc.babylonjs.com/features/featuresDeepDive/webXR/webXRSessionManagers
 */
export class WebXRSessionManager implements IDisposable, IWebXRRenderTargetTextureProvider {
    private _referenceSpace: XRReferenceSpace;
    private _baseLayerWrapper: Nullable<WebXRLayerWrapper>;
    private _baseLayerRTTProvider: Nullable<WebXRLayerRenderTargetTextureProvider>;
    private _xrNavigator: any;
    private _sessionMode: XRSessionMode;
    private _renderState: Nullable<XRRenderStateInit>;
    private _renderTarget: Nullable<WebXRRenderTarget>;
    private _onEngineDisposedObserver: Nullable<Observer<ThinEngine>>;

    /**
     * The engine the WebXR session is attached to
     */
    public engine: Engine;
    /**
     * The scene that is currently played within the WebXR session.
     * Needed by features, not this class itself
     */
    public scene: Scene;
    /**
     * Indicates whether persistent mode is activated or not
     */
    public persistent = false;
    /**
     * The base reference space from which the session started. good if you want to reset your
     * reference space
     */
    public baseReferenceSpace: XRReferenceSpace;
    /**
     * Current XR frame
     */
    public currentFrame: Nullable<XRFrame>;
    /** WebXR timestamp updated every frame */
    public currentTimestamp: number = -1;
    /**
     * Used just in case of a failure to initialize an immersive session.
     * The viewer reference space is compensated using this height, creating a kind of "viewer-floor" reference space
     */
    public defaultHeightCompensation = 1.7;
    /**
     * Fires every time a new xrFrame arrives which can be used to update the camera
     */
    public onXRFrameObservable: Observable<XRFrame> = new Observable<XRFrame>();
    /**
     * Fires when the reference space changed
     */
    public onXRReferenceSpaceChanged: Observable<XRReferenceSpace> = new Observable();
    /**
     * Fires when the xr session is ended either by the device or manually done
     */
    public onXRSessionEnded: Observable<any> = new Observable<any>();
    /**
     * Fires when the xr session is initialized: right after requestSession was called and returned with a successful result
     */
    public onXRSessionInit: Observable<XRSession> = new Observable<XRSession>();
    /**
     * Fires when the xr session is moved to another scene (in persistent mode)
     */
    public onXRSessionMoved: Observable<XRSession> = new Observable<XRSession>();
    /**
     * Underlying xr session
     */
    public session: XRSession;
    /**
     * The viewer (head position) reference space. This can be used to get the XR world coordinates
     * or get the offset the player is currently at.
     */
    public viewerReferenceSpace: XRReferenceSpace;
    /**
     * Are we currently in the XR loop?
     */
    public inXRFrameLoop: boolean = false;
    /**
     * Are we in an XR session?
     */
    public inXRSession: boolean = false;

    /**
     * Constructs a WebXRSessionManager, this must be initialized within a user action before usage
     * @param sceneOrEngine The scene or engine the helper should be created in
     * This also sets whether operating in persistent or single scene mode
     */
    constructor(sceneOrEngine: Scene | Engine) {
        if (sceneOrEngine instanceof Scene) {
            this.scene = sceneOrEngine;
            this.engine = sceneOrEngine.getEngine();
            sceneOrEngine.onDisposeObservable.addOnce(() => {
                this.dispose();
            });
        } else {
            this.engine = sceneOrEngine;
            this.persistent = true;
        }
    }

    /**
     * The current reference space used in this session. This reference space can constantly change!
     * It is mainly used to offset the camera's position.
     */
    public get referenceSpace(): XRReferenceSpace {
        return this._referenceSpace;
    }

    /**
     * Set a new reference space and triggers the observable
     */
    public set referenceSpace(newReferenceSpace: XRReferenceSpace) {
        this._referenceSpace = newReferenceSpace;
        this.onXRReferenceSpaceChanged.notifyObservers(this._referenceSpace);
    }

    /**
     * The mode for the managed XR session
     */
    public get sessionMode(): XRSessionMode {
        return this._sessionMode;
    }

    /**
     * Intended to be called by WebXRDefaultExperience.moveXRToScene().
     * Dispose has already been called; so all the observables have already been cleared out
     * @param nextScene the next scene to pass the XR session to
     * @param defExperience a reference to the existing WebXRDefaultExperience
     * @param hookUp A callback, which holds all the features which need initialized in the scene.
     */
    public async moveXRToScene(nextScene: Scene, defExperience: WebXRDefaultExperience, hookUp: (defExperience: WebXRDefaultExperience) => void): Promise<void> {
        this.scene = nextScene;

        if (this.inXRSession && this._renderState) {
            if (this._renderTarget == null) {
                const renderTarget = this.getWebXRRenderTarget();
                this.updateRenderTarget(renderTarget);
            }

            const baseLayer = await this._renderTarget?.initializeXRLayerAsync(this.session);

            // The layers feature will have already initialized the xr session's layers on session init.
            if (!this.enabledFeatures?.includes(WebXRFeatureName.LAYERS)) {
                this._renderState.baseLayer = baseLayer;
            }

            this.updateRenderState(this._renderState);
        }

        // all the old sessionInit observers are now gone; time to make some new ones
        hookUp(defExperience);

        this.onXRSessionMoved.notifyObservers(this.session);

        // the first scene will have to be user initiated; inside here will be taken care of there.
        if (this.inXRSession) {
            // now simulate that event for the new stuff
            this.onXRSessionInit.notifyObservers(this.session);
        }
    }

    /**
     * Disposes of the session manager
     * This should be called explicitly by the dev, if required.
     */
    public dispose(all: boolean = true) {
        // disposing without leaving XR? Exit XR first
        if (this.inXRSession && (!this.persistent || all)) {
            this.exitXRAsync();
        }

        this.onXRFrameObservable.clear();
        this.onXRReferenceSpaceChanged.clear();
        this.onXRSessionInit.clear();

        if (!this.persistent || all) {
            this._renderTarget = null;
            this._renderState = null;

            this.engine?.onDisposeObservable.remove(this._onEngineDisposedObserver);
            this.onXRSessionEnded.clear();
        }
    }

    /**
     * Stops the xrSession and restores the render loop
     * @returns Promise which resolves after it exits XR
     */
    public exitXRAsync() {
        if (this.session && this.inXRSession) {
            this.inXRSession = false;
            return this.session.end().catch(() => {
                Logger.Warn("Could not end XR session.");
            });
        }
        return Promise.resolve();
    }

    /**
     * Attempts to set the framebuffer-size-normalized viewport to be rendered this frame for this view.
     * In the event of a failure, the supplied viewport is not updated.
     * @param viewport the viewport to which the view will be rendered
     * @param view the view for which to set the viewport
     * @returns whether the operation was successful
     */
    public trySetViewportForView(viewport: Viewport, view: XRView): boolean {
        return this._baseLayerRTTProvider?.trySetViewportForView(viewport, view) || false;
    }

    /**
     * Gets the correct render target texture to be rendered this frame for this eye
     * @param eye the eye for which to get the render target
     * @returns the render target for the specified eye or null if not available
     */
    public getRenderTargetTextureForEye(eye: XREye): Nullable<RenderTargetTexture> {
        return this._baseLayerRTTProvider?.getRenderTargetTextureForEye(eye) || null;
    }

    /**
     * Gets the correct render target texture to be rendered this frame for this view
     * @param view the view for which to get the render target
     * @returns the render target for the specified view or null if not available
     */
    public getRenderTargetTextureForView(view: XRView): Nullable<RenderTargetTexture> {
        return this._baseLayerRTTProvider?.getRenderTargetTextureForView(view) || null;
    }

    /**
     * Creates a WebXRRenderTarget object for the XR session
     * @param options optional options to provide when creating a new render target
     * @returns a WebXR render target to which the session can render
     */
    public getWebXRRenderTarget(options?: WebXRManagedOutputCanvasOptions): WebXRRenderTarget {
        if (this._xrNavigator.xr.native) {
            return new NativeXRRenderTarget(this);
        } else {
            options = options || WebXRManagedOutputCanvasOptions.GetDefaults(this.engine);
            options.canvasElement = options.canvasElement || this.engine.getRenderingCanvas() || undefined;
            return new WebXRManagedOutputCanvas(this, options);
        }
    }

    /**
     * Initializes the manager
     * After initialization enterXR can be called to start an XR session
     * @returns Promise which resolves after it is initialized
     */
    public initializeAsync(): Promise<void> {
        // Check if the browser supports webXR
        this._xrNavigator = navigator;
        if (!this._xrNavigator.xr) {
            return Promise.reject("WebXR not available");
        }
        return Promise.resolve();
    }

    /**
     * Initializes an xr session
     * @param xrSessionMode mode to initialize
     * @param xrSessionInit defines optional and required values to pass to the session builder
     * @returns a promise which will resolve once the session has been initialized
     */
    public initializeSessionAsync(xrSessionMode: XRSessionMode = "immersive-vr", xrSessionInit: XRSessionInit = {}): Promise<XRSession> {
        return this._xrNavigator.xr.requestSession(xrSessionMode, xrSessionInit).then((session: XRSession) => {
            this.session = session;
            this._sessionMode = xrSessionMode;
            this.onXRSessionInit.notifyObservers(session);
            this.inXRSession = true;

            // handle when the session is ended (By calling session.end or device ends its own session eg. pressing home button on phone)
            this.session.addEventListener(
                "end",
                () => {
                    this.inXRSession = false;

                    // Notify frame observers
                    this.onXRSessionEnded.notifyObservers(null);

                    if (this.engine) {
                        // make sure dimensions object is restored
                        this.engine.framebufferDimensionsObject = null;

                        // Restore frame buffer to avoid clear on xr framebuffer after session end
                        this.engine.restoreDefaultFramebuffer();

                        // Need to restart render loop as after the session is ended the last request for new frame will never call callback
                        this.engine.customAnimationFrameRequester = null;
                        this.engine._renderLoop();
                    }

                    // Dispose render target textures.
                    // Only dispose on native because we can't destroy opaque textures on browser.
                    if (this.isNative) {
                        this._baseLayerRTTProvider?.dispose();
                    }
                    this._baseLayerRTTProvider = null;
                    this._baseLayerWrapper = null;
                },
                { once: true }
            );

            return this.session;
        });
    }

    /**
     * Checks if a session would be supported for the creation options specified
     * @param sessionMode session mode to check if supported eg. immersive-vr
     * @returns A Promise that resolves to true if supported and false if not
     */
    public isSessionSupportedAsync(sessionMode: XRSessionMode): Promise<boolean> {
        return WebXRSessionManager.IsSessionSupportedAsync(sessionMode);
    }

    /**
     * Resets the reference space to the one started the session
     */
    public resetReferenceSpace() {
        this.referenceSpace = this.baseReferenceSpace;
    }

    /**
     * Starts rendering to the xr layer
     */
    public runXRRenderLoop() {
        if (!this.inXRSession || !this.engine) {
            return;
        }

        // Tell the engine's render loop to be driven by the xr session's refresh rate and provide xr pose information
        this.engine.customAnimationFrameRequester = {
            requestAnimationFrame: (callback: FrameRequestCallback) => this.session.requestAnimationFrame(callback),
            renderFunction: (timestamp: number, xrFrame: Nullable<XRFrame>) => {
                if (!this.inXRSession || !this.engine) {
                    return;
                }
                // Store the XR frame and timestamp in the session manager
                this.currentFrame = xrFrame;
                this.currentTimestamp = timestamp;
                if (xrFrame) {
                    this.inXRFrameLoop = true;
                    this.engine.framebufferDimensionsObject = this._baseLayerRTTProvider?.getFramebufferDimensions() || null;
                    this.onXRFrameObservable.notifyObservers(xrFrame);
                    this.engine._renderLoop();
                    this.engine.framebufferDimensionsObject = null;
                    this.inXRFrameLoop = false;
                }
            },
        };

        this.engine.framebufferDimensionsObject = this._baseLayerRTTProvider?.getFramebufferDimensions() || null;

        // Stop window's animation frame and trigger sessions animation frame
        if (typeof window !== "undefined" && window.cancelAnimationFrame) {
            window.cancelAnimationFrame(this.engine._frameHandler);
        }
        this.engine._renderLoop();
    }

    /**
     * Sets the reference space on the xr session
     * @param referenceSpaceType space to set
     * @returns a promise that will resolve once the reference space has been set
     */
    public setReferenceSpaceTypeAsync(referenceSpaceType: XRReferenceSpaceType = "local-floor"): Promise<XRReferenceSpace> {
        return this.session
            .requestReferenceSpace(referenceSpaceType)
            .then(
                (referenceSpace) => {
                    return referenceSpace as XRReferenceSpace;
                },
                (rejectionReason) => {
                    Logger.Error("XR.requestReferenceSpace failed for the following reason: ");
                    Logger.Error(rejectionReason);
                    Logger.Log('Defaulting to universally-supported "viewer" reference space type.');

                    return this.session.requestReferenceSpace("viewer").then(
                        (referenceSpace) => {
                            const heightCompensation = new XRRigidTransform({ x: 0, y: -this.defaultHeightCompensation, z: 0 });
                            return (referenceSpace as XRReferenceSpace).getOffsetReferenceSpace(heightCompensation);
                        },
                        (rejectionReason) => {
                            Logger.Error(rejectionReason);
                            throw 'XR initialization failed: required "viewer" reference space type not supported.';
                        }
                    );
                }
            )
            .then((referenceSpace) => {
                // create viewer reference space before setting the first reference space
                return this.session.requestReferenceSpace("viewer").then((viewerReferenceSpace) => {
                    this.viewerReferenceSpace = viewerReferenceSpace as XRReferenceSpace;
                    return referenceSpace;
                });
            })
            .then((referenceSpace) => {
                // initialize the base and offset (currently the same)
                this.referenceSpace = this.baseReferenceSpace = referenceSpace;
                return this.referenceSpace;
            });
    }

    /**
     * Updates the render state of the session.
     * Note that this is deprecated in favor of WebXRSessionManager.updateRenderState().
     * @param state state to set
     * @returns a promise that resolves once the render state has been updated
     * @deprecated
     */
    public updateRenderStateAsync(state: XRRenderState): Promise<void> {
        return Promise.resolve(this.session.updateRenderState(state));
    }

    /**
     * @internal
     */
    public _setBaseLayerWrapper(baseLayerWrapper: Nullable<WebXRLayerWrapper>): void {
        this._baseLayerRTTProvider?.dispose();

        this._baseLayerWrapper = baseLayerWrapper;

        this._baseLayerRTTProvider = this._baseLayerWrapper?.createRenderTargetTextureProvider(this) || null;
    }

    /**
     * @internal
     */
    public _getBaseLayerWrapper(): Nullable<WebXRLayerWrapper> {
        return this._baseLayerWrapper;
    }

    /**
     * Updates the render target of the session
     * @param renderTarget renderTarget to set
     */
    public updateRenderTarget(renderTarget: WebXRRenderTarget): void {
        this._renderTarget = renderTarget;
    }

    /**
     * Updates the render state of the session
     * @param state state to set
     */
    public updateRenderState(state: XRRenderStateInit): void {
        this._renderState = state;

        if (state.baseLayer) {
            this._setBaseLayerWrapper(this.isNative ? new NativeXRLayerWrapper(state.baseLayer) : new WebXRWebGLLayerWrapper(state.baseLayer));
        }

        this.session.updateRenderState(state);
    }

    /**
     * Returns a promise that resolves with a boolean indicating if the provided session mode is supported by this browser
     * @param sessionMode defines the session to test
     * @returns a promise with boolean as final value
     */
    public static IsSessionSupportedAsync(sessionMode: XRSessionMode): Promise<boolean> {
        if (!(navigator as any).xr) {
            return Promise.resolve(false);
        }
        // When the specs are final, remove supportsSession!
        const functionToUse = (navigator as any).xr.isSessionSupported || (navigator as any).xr.supportsSession;
        if (!functionToUse) {
            return Promise.resolve(false);
        } else {
            return functionToUse
                .call((navigator as any).xr, sessionMode)
                .then((result: boolean) => {
                    const returnValue = typeof result === "undefined" ? true : result;
                    return Promise.resolve(returnValue);
                })
                .catch((e: any) => {
                    Logger.Warn(e);
                    return Promise.resolve(false);
                });
        }
    }

    /**
     * Returns true if Babylon.js is using the BabylonNative backend, otherwise false
     */
    public get isNative(): boolean {
        return this._xrNavigator.xr.native ?? false;
    }

    /**
     * The current frame rate as reported by the device
     */
    public get currentFrameRate(): number | undefined {
        return this.session?.frameRate;
    }

    /**
     * A list of supported frame rates (only available in-session!
     */
    public get supportedFrameRates(): Float32Array | undefined {
        return this.session?.supportedFrameRates;
    }

    /**
     * Set the framerate of the session.
     * @param rate the new framerate. This value needs to be in the supportedFrameRates array
     * @returns a promise that resolves once the framerate has been set
     */
    public updateTargetFrameRate(rate: number): Promise<void> {
        return this.session.updateTargetFrameRate(rate);
    }

    /**
     * Run a callback in the xr render loop
     * @param callback the callback to call when in XR Frame
     * @param ignoreIfNotInSession if no session is currently running, run it first thing on the next session
     */
    public runInXRFrame(callback: () => void, ignoreIfNotInSession = true): void {
        if (this.inXRFrameLoop) {
            callback();
        } else if (this.inXRSession || !ignoreIfNotInSession) {
            this.onXRFrameObservable.addOnce(callback);
        }
    }

    /**
     * Check if fixed foveation is supported on this device
     */
    public get isFixedFoveationSupported(): boolean {
        return this._baseLayerWrapper?.isFixedFoveationSupported || false;
    }

    /**
     * Get the fixed foveation currently set, as specified by the webxr specs
     * If this returns null, then fixed foveation is not supported
     */
    public get fixedFoveation(): Nullable<number> {
        return this._baseLayerWrapper?.fixedFoveation || null;
    }

    /**
     * Set the fixed foveation to the specified value, as specified by the webxr specs
     * This value will be normalized to be between 0 and 1, 1 being max foveation, 0 being no foveation
     */
    public set fixedFoveation(value: Nullable<number>) {
        const val = Math.max(0, Math.min(1, value || 0));
        if (this._baseLayerWrapper) {
            this._baseLayerWrapper.fixedFoveation = val;
        }
    }

    /**
     * Get the features enabled on the current session
     * This is only available in-session!
     * @see https://www.w3.org/TR/webxr/#dom-xrsession-enabledfeatures
     */
    public get enabledFeatures(): Nullable<string[]> {
        return this.session?.enabledFeatures ?? null;
    }
}
