import React from 'react';
import {Composition} from 'remotion';
import {GuanhengVideo} from './GuanhengVideo';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="GuanhengBrand"
      component={GuanhengVideo}
      durationInFrames={1800}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{bgm: true}}
    />
  );
};
