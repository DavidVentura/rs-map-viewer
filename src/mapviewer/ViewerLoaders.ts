import { CacheInfo } from "../rs/cache/CacheInfo";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { CacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { Dat2CacheLoaderFactory } from "../rs/cache/loader/Dat2CacheLoaderFactory";
import { BasTypeLoader } from "../rs/config/bastype/BasTypeLoader";
import { LocTypeLoader } from "../rs/config/loctype/LocTypeLoader";
import { NpcTypeLoader } from "../rs/config/npctype/NpcTypeLoader";
import { ObjTypeLoader } from "../rs/config/objtype/ObjTypeLoader";
import { SeqTypeLoader } from "../rs/config/seqtype/SeqTypeLoader";
import { VarManager } from "../rs/config/vartype/VarManager";
import { SeqFrameLoader } from "../rs/model/seq/SeqFrameLoader";
import { TextureLoader } from "../rs/texture/TextureLoader";

export type ViewerLoaders = {
    readonly loaderFactory: CacheLoaderFactory;
    readonly textureLoader: TextureLoader;
    readonly seqTypeLoader: SeqTypeLoader;
    readonly seqFrameLoader: SeqFrameLoader;
    readonly locTypeLoader: LocTypeLoader;
    readonly objTypeLoader: ObjTypeLoader;
    readonly npcTypeLoader: NpcTypeLoader;
    readonly basTypeLoader: BasTypeLoader;
    readonly varManager: VarManager;
};

// The main thread's loaders, built from a cache before anything is loaded by id.
export function createViewerLoaders(info: CacheInfo, cacheSystem: CacheSystem): ViewerLoaders {
    const loaderFactory = new Dat2CacheLoaderFactory(info, cacheSystem);

    const varManager = new VarManager(loaderFactory.getVarBitTypeLoader());
    const questTypeLoader = loaderFactory.getQuestTypeLoader();
    if (questTypeLoader) {
        varManager.setQuestsCompleted(questTypeLoader);
    }

    return {
        loaderFactory,
        textureLoader: loaderFactory.getTextureLoader(),
        seqTypeLoader: loaderFactory.getSeqTypeLoader(),
        seqFrameLoader: loaderFactory.getSeqFrameLoader(),
        locTypeLoader: loaderFactory.getLocTypeLoader(),
        objTypeLoader: loaderFactory.getObjTypeLoader(),
        npcTypeLoader: loaderFactory.getNpcTypeLoader(),
        basTypeLoader: loaderFactory.getBasTypeLoader(),
        varManager,
    };
}
