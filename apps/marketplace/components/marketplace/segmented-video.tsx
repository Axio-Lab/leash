'use client';

import * as React from 'react';

type SegmentedVideoProps = React.VideoHTMLAttributes<HTMLVideoElement> & {
  start: number;
  end: number;
};

export function SegmentedVideo({ start, end, ...props }: SegmentedVideoProps) {
  const ref = React.useRef<HTMLVideoElement>(null);
  const segmentEnd = Math.max(end, start + 0.5);

  const resetToStart = React.useCallback(() => {
    const video = ref.current;
    if (!video) return;
    video.currentTime = start;
    void video.play().catch(() => {
      // Autoplay can be blocked in rare browser states. Controls are hidden
      // because the video is a silent product preview, so failing quietly is ok.
    });
  }, [start]);

  return (
    <video
      ref={ref}
      muted
      autoPlay
      playsInline
      preload="metadata"
      onLoadedMetadata={resetToStart}
      onTimeUpdate={(event) => {
        if (event.currentTarget.currentTime >= segmentEnd) {
          event.currentTarget.currentTime = start;
          void event.currentTarget.play();
        }
      }}
      {...props}
    />
  );
}
