import * as React from "react";
import type { Observable } from "core/Misc/observable";
import type { TargetedAnimation, AnimationGroup } from "core/Animations/animationGroup";
import type { Scene } from "core/scene";
import type { PropertyChangedEvent } from "../../../../propertyChangedEvent";
import { ButtonLineComponent } from "shared-ui-components/lines/buttonLineComponent";
import { LineContainerComponent } from "shared-ui-components/lines/lineContainerComponent";
import { TextLineComponent } from "shared-ui-components/lines/textLineComponent";
import type { LockObject } from "shared-ui-components/tabs/propertyGrids/lockObject";
import type { GlobalState } from "../../../../globalState";
import { TextInputLineComponent } from "shared-ui-components/lines/textInputLineComponent";

import { AnimationCurveEditorComponent } from "./curveEditor/animationCurveEditorComponent";
import { Context } from "./curveEditor/context";

interface ITargetedAnimationGridComponentProps {
    globalState: GlobalState;
    targetedAnimation: TargetedAnimation;
    scene: Scene;
    lockObject: LockObject;
    onSelectionChangedObservable?: Observable<any>;
    onPropertyChangedObservable?: Observable<PropertyChangedEvent>;
}

export class TargetedAnimationGridComponent extends React.Component<ITargetedAnimationGridComponentProps> {
    private _animationGroup: AnimationGroup | undefined;
    private _animationCurveEditorContext: Context;

    constructor(props: ITargetedAnimationGridComponentProps) {
        super(props);
    }

    findAnimationGroup = () => {
        this._animationGroup = this.props.scene.animationGroups.find((ag) => {
            const ta = ag.targetedAnimations.find((ta) => ta === this.props.targetedAnimation);
            return ta !== undefined;
        });
    };

    playOrPause = () => {
        if (this._animationGroup) {
            if (this._animationGroup.isPlaying) {
                this._animationGroup.stop();
            } else {
                this._animationGroup.start();
            }
            this.forceUpdate();
        }
    };

    deleteAnimation = () => {
        if (this._animationGroup) {
            const index = this._animationGroup.targetedAnimations.indexOf(this.props.targetedAnimation);

            if (index > -1) {
                this._animationGroup.targetedAnimations.splice(index, 1);
                this.props.onSelectionChangedObservable?.notifyObservers(null);

                if (this._animationGroup.isPlaying) {
                    this._animationGroup.stop();
                    this._animationGroup.start();
                }
            }
        }
    };

    updateContextFromProps = () => {
        if (!this._animationCurveEditorContext) {
            this._animationCurveEditorContext = new Context();
        }
        this._animationCurveEditorContext.title = this.props.targetedAnimation.target.name || "";
        this._animationCurveEditorContext.animations = [this.props.targetedAnimation.animation];
        this._animationCurveEditorContext.target = this.props.targetedAnimation.target;
        this._animationCurveEditorContext.scene = this.props.scene;
        if (this._animationGroup) {
            this._animationCurveEditorContext.rootAnimationGroup = this._animationGroup;
        }
    };

    override componentDidMount() {
        this.findAnimationGroup();
        this.updateContextFromProps();
    }

    override componentDidUpdate(prevProps: Readonly<ITargetedAnimationGridComponentProps>, prevState: Readonly<{}>, snapshot?: any): void {
        if (prevProps.targetedAnimation !== this.props.targetedAnimation) {
            this.findAnimationGroup();
            this.updateContextFromProps();
        }
    }

    override render() {
        const targetedAnimation = this.props.targetedAnimation;

        return (
            <>
                <LineContainerComponent title="GENERAL" selection={this.props.globalState}>
                    <TextLineComponent label="Class" value={targetedAnimation.getClassName()} />
                    <TextInputLineComponent
                        lockObject={this.props.lockObject}
                        label="Name"
                        target={targetedAnimation.animation}
                        propertyName="name"
                        onPropertyChangedObservable={this.props.onPropertyChangedObservable}
                    />
                    {targetedAnimation.target.name && (
                        <TextLineComponent
                            label="Target"
                            value={targetedAnimation.target.name}
                            onLink={() => this.props.globalState.onSelectionChangedObservable.notifyObservers(targetedAnimation.target)}
                        />
                    )}
                    {this._animationCurveEditorContext && <AnimationCurveEditorComponent globalState={this.props.globalState} context={this._animationCurveEditorContext} />}
                    <ButtonLineComponent label="Dispose" onClick={this.deleteAnimation} />
                </LineContainerComponent>
            </>
        );
    }
}
