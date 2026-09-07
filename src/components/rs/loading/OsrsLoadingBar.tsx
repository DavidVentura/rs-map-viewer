import "./OsrsLoadingBar.css";

interface OsrsLoadingBarProps {
    text: string;
    // Omitted for phases with no measurable progress (e.g. waiting on a worker bake): the bar
    // fills fully and the text drops its percentage rather than lying about how far along it is.
    progress?: number;
}

export function OsrsLoadingBar({ text, progress }: OsrsLoadingBarProps): JSX.Element {
    return (
        <div className="loading-bar">
            <div className="loading-bar-progress-container">
                <div
                    className="loading-bar-progress"
                    style={{ width: (progress ?? 100) + "%" }}
                ></div>
            </div>
            <div className="loading-bar-text">
                {progress === undefined ? text : `${text} - ${progress}%`}
            </div>
        </div>
    );
}
