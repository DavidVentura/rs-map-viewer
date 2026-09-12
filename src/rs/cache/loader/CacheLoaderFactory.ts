import { BasTypeLoader } from "../../config/bastype/BasTypeLoader";
import { FloorTypeLoader, OverlayFloorTypeLoader } from "../../config/floortype/FloorTypeLoader";
import { LocTypeLoader } from "../../config/loctype/LocTypeLoader";
import { NpcTypeLoader } from "../../config/npctype/NpcTypeLoader";
import { ObjTypeLoader } from "../../config/objtype/ObjTypeLoader";
import { QuestTypeLoader } from "../../config/questtype/QuestTypeLoader";
import { SeqTypeLoader } from "../../config/seqtype/SeqTypeLoader";
import { SpotAnimTypeLoader } from "../../config/spotanimtype/SpotAnimTypeLoader";
import { VarBitTypeLoader } from "../../config/vartype/bit/VarBitTypeLoader";
import { MapFileLoader } from "../../map/MapFileLoader";
import { ModelLoader } from "../../model/ModelLoader";
import { SeqFrameLoader } from "../../model/seq/SeqFrameLoader";
import { SkeletalSeqLoader } from "../../model/skeletal/SkeletalSeqLoader";
import { IndexedSprite } from "../../sprite/IndexedSprite";
import { TextureLoader } from "../../texture/TextureLoader";

export interface CacheLoaderFactory {
    getUnderlayTypeLoader(): FloorTypeLoader;
    getOverlayTypeLoader(): OverlayFloorTypeLoader;

    getVarBitTypeLoader(): VarBitTypeLoader;

    getLocTypeLoader(): LocTypeLoader;
    getNpcTypeLoader(): NpcTypeLoader;
    getObjTypeLoader(): ObjTypeLoader;

    getSeqTypeLoader(): SeqTypeLoader;
    getSpotAnimTypeLoader(): SpotAnimTypeLoader | undefined;

    getBasTypeLoader(): BasTypeLoader;

    getQuestTypeLoader(): QuestTypeLoader | undefined;

    getTextureLoader(): TextureLoader;

    getModelLoader(): ModelLoader;
    getSeqFrameLoader(): SeqFrameLoader;
    getSkeletalSeqLoader(): SkeletalSeqLoader | undefined;

    getMapFileLoader(): MapFileLoader;

    getMapScenes(): IndexedSprite[];
    getMapFunctions(): IndexedSprite[];
}
