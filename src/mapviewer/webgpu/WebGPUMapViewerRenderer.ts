import { isWebGPUSupported } from "../../util/DeviceUtil";
import { ResidencyPolicyKind } from "../MapManager";
import { MapViewer } from "../MapViewer";
import { MapViewerRenderer } from "../MapViewerRenderer";
import { MapViewerRendererType, WEBGPU } from "../MapViewerRenderers";
import { Terrain } from "../game/Terrain";
import fullscreenTexturedQuadShader from "./shaders/fullscreenTexturedQuad.wgsl?source";

const ENABLED = false;

export class WebGPUMapViewerRenderer extends MapViewerRenderer {
    type: MapViewerRendererType = WEBGPU;

    adapter!: GPUAdapter;
    device!: GPUDevice;

    context!: GPUCanvasContext;

    fullscreenQuadPipeline!: GPURenderPipeline;

    sampler!: GPUSampler;

    textureArray!: GPUTexture;

    showResultBindGroup!: GPUBindGroup;

    constructor(mapViewer: MapViewer) {
        super(mapViewer, ResidencyPolicyKind.CAMERA_FLY_OVER);
    }

    createTerrain(): Terrain {
        throw new Error("Not supported");
    }

    static isSupported(): boolean {
        return isWebGPUSupported && ENABLED;
    }

    async init(): Promise<void> {
        await super.init();

        const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!adapter) {
            throw new Error("No adapter found");
        }
        this.adapter = adapter;
        const device = (this.device = await adapter.requestDevice());

        this.context = this.canvas.getContext("webgpu")!;

        const preferredFormat = navigator.gpu.getPreferredCanvasFormat();

        this.context.configure({
            device: this.device,
            format: preferredFormat,
            alphaMode: "premultiplied",
        });

        const fullscreenTexturedQuadShaderModule = device.createShaderModule({
            code: fullscreenTexturedQuadShader,
        });

        this.fullscreenQuadPipeline = device.createRenderPipeline({
            layout: "auto",
            vertex: {
                module: fullscreenTexturedQuadShaderModule,
                entryPoint: "vert_main",
            },
            fragment: {
                module: fullscreenTexturedQuadShaderModule,
                entryPoint: "frag_main",
                targets: [
                    {
                        format: preferredFormat,
                    },
                ],
            },
            primitive: {
                topology: "triangle-list",
            },
        });

        this.sampler = device.createSampler({
            magFilter: "linear",
            minFilter: "linear",
        });

        console.log(adapter.limits);

        this.initTextures();

        this.showResultBindGroup = device.createBindGroup({
            layout: this.fullscreenQuadPipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: this.sampler,
                },
                {
                    binding: 1,
                    resource: this.textureArray.createView(),
                },
            ],
        });
    }

    // Only layer 0 (white) is filled: a pack holds the sprites of just the textures its models and
    // floors use, so a texture's pixels can only come with a load that uses it.
    initTextures(): void {
        const textureLoader = this.mapViewer.textureLoader;

        const textureIds = textureLoader
            .getTextureIds()
            .slice(0, this.device.limits.maxTextureArrayLayers - 1);
        const textureCount = textureIds.length + 1;

        const textureSize = 128;

        const pixelCount = textureSize * textureSize;

        const pixels = new Int32Array(textureCount * pixelCount);
        // White texture
        pixels.fill(0xffffffff, 0, pixelCount);

        this.textureArray = this.device.createTexture({
            size: {
                width: textureSize,
                height: textureSize,
                depthOrArrayLayers: textureCount,
            },
            format: "rgba8unorm",
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
        });

        this.device.queue.writeTexture(
            {
                texture: this.textureArray,
            },
            pixels,
            {
                bytesPerRow: textureSize * 4,
                rowsPerImage: textureSize,
            },
            {
                width: textureSize,
                height: textureSize,
                depthOrArrayLayers: textureCount,
            },
        );
    }

    render(time: number, deltaTime: number, resized: boolean): void {
        const camera = this.mapViewer.camera;

        this.handleInput(deltaTime);

        camera.update(this.canvas.width, this.canvas.height);

        const device = this.device;
        const context = this.context;

        const commandEncoder = device.createCommandEncoder();
        const textureView = context.getCurrentTexture().createView();

        const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [
                {
                    view: textureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(this.fullscreenQuadPipeline);
        passEncoder.setBindGroup(0, this.showResultBindGroup);
        passEncoder.draw(6);

        passEncoder.end();

        device.queue.submit([commandEncoder.finish()]);
    }
}
