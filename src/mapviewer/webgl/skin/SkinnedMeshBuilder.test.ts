import { Model } from "../../../rs/model/Model";
import { SeqBase } from "../../../rs/model/seq/SeqBase";
import { SeqFrame } from "../../../rs/model/seq/SeqFrame";
import { SeqTransformType } from "../../../rs/model/seq/SeqTransformType";
import { TextureLoader } from "../../../rs/texture/TextureLoader";
import { SkinRig } from "./SkinRig";
import { SkinFaceSelection, SkinnedMeshBuilder } from "./SkinnedMeshBuilder";

const textureLoader = {
    isTransparent: (id: number) => id === 5,
} as TextureLoader;

function alphaFrame(...labels: number[]): SeqFrame {
    const base = new SeqBase(0, 1, [SeqTransformType.ALPHA], [true], new Uint16Array([0xffff]), [
        labels,
    ]);
    return new SeqFrame(1, base, 1, [0], [1], [0], [0], [-1], true);
}

function translateFrame(...labels: number[]): SeqFrame {
    const base = new SeqBase(
        0,
        1,
        [SeqTransformType.TRANSLATE],
        [true],
        new Uint16Array([0xffff]),
        [labels],
    );
    return new SeqFrame(1, base, 1, [0], [4], [0], [0], [-1], false);
}

function actorModel(): Model {
    const model = new Model();
    model.verticesCount = 3;
    model.usedVertexCount = 3;
    model.verticesX = new Int32Array([0, 64, 0]);
    model.verticesY = new Int32Array([0, 0, 64]);
    model.verticesZ = new Int32Array([0, 0, 0]);
    model.vertexLabels = Array.from({ length: 21 }, () => new Int32Array());
    model.vertexLabels[10] = new Int32Array([0, 1]);
    model.vertexLabels[20] = new Int32Array([2]);

    model.faceCount = 5;
    model.indices1 = new Int32Array(5).fill(0);
    model.indices2 = new Int32Array(5).fill(1);
    model.indices3 = new Int32Array(5).fill(2);
    model.faceColors1 = new Int32Array([100, 200, 300, 400, 500]);
    model.faceColors2 = new Int32Array([101, 201, 301, 401, 501]);
    model.faceColors3 = new Int32Array([102, 202, 302, 402, 502]);
    model.faceAlphas = new Int8Array([0, 50, -1, -1, 100]);
    model.faceTextures = new Int16Array([-1, -1, -1, -1, 5]);
    model.faceRenderPriorities = new Int8Array(5);
    model.faceLabels = Array.from({ length: 9 }, () => new Int32Array());
    model.faceLabels[7] = new Int32Array([2, 4]);
    model.faceLabels[8] = new Int32Array([3]);
    model.uvs = new Float32Array(5 * 6);
    return model;
}

describe("SkinnedMeshBuilder", () => {
    it("writes fixed opaque and transparent ranges with packed rig metadata", () => {
        const model = actorModel();
        const rig = SkinRig.oldStyle([model], [alphaFrame(7), translateFrame(10, 20)]);
        const builder = new SkinnedMeshBuilder(textureLoader, new Map([[5, 9]]));

        const mesh = builder.addModel(model, rig, SkinFaceSelection.all());
        const data = builder.build();

        expect(mesh.opaque).toEqual([0, 3, 1]);
        expect(mesh.transparent).toEqual([12, 9, 1]);
        expect(data.indices).toHaveLength(12);
        expect(data.vertices.byteLength % 16).toBe(0);
        expect(data.influences).toEqual(new Uint32Array([0x00ff0001, 0x00ff0002]));
        expect(data.usedTextureIds).toEqual(new Set([5]));

        const words = new Uint32Array(
            data.vertices.buffer,
            data.vertices.byteOffset,
            data.vertices.byteLength / 4,
        );
        const animatedFaceVertex = data.indices[6];
        const texturedFaceVertex = data.indices[9];
        expect(words[animatedFaceVertex * 4 + 3] >>> 24).toBe(1);
        expect(words[texturedFaceVertex * 4 + 3] >>> 24).toBe(0);
    });

    it("keeps invisible alpha-animated faces and drops other invisible faces", () => {
        const model = actorModel();
        const builder = new SkinnedMeshBuilder(textureLoader, new Map([[5, 9]]));
        const rig = SkinRig.oldStyle([model], [alphaFrame(7)]);

        const mesh = builder.addModel(model, rig, SkinFaceSelection.startingAt(2));

        expect(mesh.opaque).toEqual([0, 0, 1]);
        expect(mesh.transparent).toEqual([0, 6, 1]);
    });

    it("keys vertex reuse on the influence and alpha metadata word", () => {
        const model = actorModel();
        model.faceCount = 2;
        model.faceColors1 = new Int32Array([100, 100]);
        model.faceColors2 = new Int32Array([101, 101]);
        model.faceColors3 = new Int32Array([102, 102]);
        model.faceAlphas = new Int8Array(2);
        model.faceTextures = new Int16Array([-1, -1]);
        model.faceLabels = Array.from({ length: 10 }, () => new Int32Array());
        model.faceLabels[7] = new Int32Array([0]);
        model.faceLabels[9] = new Int32Array([1]);
        const builder = new SkinnedMeshBuilder(textureLoader, new Map());
        const rig = SkinRig.oldStyle([model], [alphaFrame(7, 9)]);

        builder.addModel(model, rig, SkinFaceSelection.all());
        const data = builder.build();

        expect(data.vertices.byteLength / 16).toBe(6);
    });

    it("maps unlabeled vertices to the reserved rest-pose matrix", () => {
        const model = actorModel();
        model.vertexLabels[10] = new Int32Array([0]);
        const builder = new SkinnedMeshBuilder(textureLoader, new Map([[5, 9]]));
        const rig = SkinRig.oldStyle([model], []);

        builder.addModel(model, rig, SkinFaceSelection.all());
        expect(builder.build().influences).toContain(0x00ff0000);
    });

    it("gives rows only to labels the rig's models have and its frames move or fade", () => {
        const model = actorModel();
        const rig = SkinRig.oldStyle([model], [translateFrame(20, 40), alphaFrame(8, 50)]);

        expect(rig.matrixSourceLabels).toEqual([SkinRig.REST_MATRIX_SOURCE_LABEL, 20]);
        expect(rig.alphaSourceLabels).toEqual([8]);
        expect(rig.matrixIndex(10)).toBe(0);
        expect(rig.matrixIndex(20)).toBe(1);
    });

    it("rejects vertex labels from models that are not part of the rig", () => {
        const rig = SkinRig.oldStyle([actorModel()], [translateFrame(10)]);

        expect(() => rig.matrixIndex(30)).toThrow("Vertex label 30 is absent");
    });
});
