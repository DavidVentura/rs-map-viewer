import { Model } from "../../model/Model";
import { locPoseSpace } from "./LocModelLoader";
import { LocModelType } from "./LocModelType";

function point(): Model {
    const model = new Model();
    model.verticesCount = 1;
    model.verticesX = new Int32Array([300]);
    model.verticesY = new Int32Array([-40]);
    model.verticesZ = new Int32Array([-120]);
    return model;
}

// The rotate-back / rotate-forward / diagonal steps LocModelLoader applies around animate().
function cpuPose(model: Model, type: LocModelType, rotation: number, stage: "toPose" | "full") {
    const quarterTurns = rotation & 3;
    if (quarterTurns === 1) {
        model.rotate270();
    } else if (quarterTurns === 2) {
        model.rotate180();
    } else if (quarterTurns === 3) {
        model.rotate90();
    }
    if (stage === "toPose") {
        return;
    }
    if (quarterTurns === 1) {
        model.rotate90();
    } else if (quarterTurns === 2) {
        model.rotate180();
    } else if (quarterTurns === 3) {
        model.rotate270();
    }
    if (type === LocModelType.NORMAL && rotation > 3) {
        model.rotate(256);
    }
}

describe("locPoseSpace", () => {
    for (const type of [LocModelType.NORMAL, LocModelType.WALL]) {
        for (let rotation = 0; rotation < 8; rotation++) {
            it(`matches the loader's rotations for type ${type} rotation ${rotation}`, () => {
                const space = locPoseSpace(type, rotation);

                const posed = point();
                cpuPose(posed, type, rotation, "toPose");
                expect(space.toPose.transformPoint(300, -40, -120)).toEqual([
                    posed.verticesX[0],
                    posed.verticesY[0],
                    posed.verticesZ[0],
                ]);

                const rest = point();
                cpuPose(rest, type, rotation, "full");
                const actual = space.restTransform().transformPoint(300, -40, -120);
                expect(Math.abs(actual[0] - rest.verticesX[0])).toBeLessThanOrEqual(1);
                expect(actual[1]).toBe(rest.verticesY[0]);
                expect(Math.abs(actual[2] - rest.verticesZ[0])).toBeLessThanOrEqual(1);
            });
        }
    }
});
