import { mat4, vec4 } from "gl-matrix";

function unprojectPoint(inverseViewProjMatrix: mat4, x: number, y: number, z: number): vec4 {
    const point = vec4.fromValues(x, y, z, 1);
    vec4.transformMat4(point, point, inverseViewProjMatrix);
    point[0] /= point[3];
    point[1] /= point[3];
    point[2] /= point[3];
    return point;
}

export function screenToGroundPoint(
    viewProjMatrix: mat4,
    screenX: number,
    screenY: number,
    rectWidth: number,
    rectHeight: number,
    groundHeight: number,
): { x: number; y: number } | undefined {
    const inverseViewProjMatrix = mat4.create();
    if (!mat4.invert(inverseViewProjMatrix, viewProjMatrix)) {
        return undefined;
    }

    const clipX = (screenX / rectWidth) * 2 - 1;
    const clipY = 1 - (screenY / rectHeight) * 2;

    const nearPoint = unprojectPoint(inverseViewProjMatrix, clipX, clipY, -1);
    const farPoint = unprojectPoint(inverseViewProjMatrix, clipX, clipY, 1);

    const directionX = farPoint[0] - nearPoint[0];
    const directionY = farPoint[1] - nearPoint[1];
    const directionZ = farPoint[2] - nearPoint[2];
    if (directionY === 0) {
        return undefined;
    }

    const distance = (-groundHeight / 128 - nearPoint[1]) / directionY;
    return {
        x: (nearPoint[0] + directionX * distance) * 128,
        y: (nearPoint[2] + directionZ * distance) * 128,
    };
}

export function worldToScreen(
    viewProjMatrix: mat4,
    worldX: number,
    worldY: number,
    groundHeight: number,
    rectWidth: number,
    rectHeight: number,
): { x: number; y: number } | undefined {
    const point = vec4.fromValues(worldX / 128, -groundHeight / 128, worldY / 128, 1);
    vec4.transformMat4(point, point, viewProjMatrix);
    if (point[3] <= 0) {
        return undefined;
    }

    const ndcX = point[0] / point[3];
    const ndcY = point[1] / point[3];
    return {
        x: ((ndcX + 1) / 2) * rectWidth,
        y: ((1 - ndcY) / 2) * rectHeight,
    };
}

export function worldRadiusToScreenPx(
    viewProjMatrix: mat4,
    worldX: number,
    worldY: number,
    groundHeight: number,
    radius: number,
    rectWidth: number,
    rectHeight: number,
): number | undefined {
    const center = worldToScreen(
        viewProjMatrix,
        worldX,
        worldY,
        groundHeight,
        rectWidth,
        rectHeight,
    );
    const edge = worldToScreen(
        viewProjMatrix,
        worldX + radius,
        worldY,
        groundHeight,
        rectWidth,
        rectHeight,
    );
    if (!center || !edge) {
        return undefined;
    }
    return Math.hypot(edge.x - center.x, edge.y - center.y);
}
