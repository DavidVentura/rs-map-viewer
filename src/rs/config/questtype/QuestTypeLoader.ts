import { Archive } from "../../cache/Archive";
import { CacheInfo } from "../../cache/CacheInfo";
import { ArchiveTypeLoader, TypeLoader } from "../TypeLoader";
import { QuestType } from "./QuestType";

export class ArchiveQuestTypeLoader
    extends ArchiveTypeLoader<QuestType>
    implements TypeLoader<QuestType>
{
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(QuestType, cacheInfo, archive);
    }
}

// Archive-backed, so callers can walk the quest ids the cache has rather than a 0..count range.
export type QuestTypeLoader = ArchiveQuestTypeLoader;
