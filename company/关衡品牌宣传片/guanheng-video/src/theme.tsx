import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';

export const C = {blue:'#176BEF',blueDeep:'#0757D5',blueSoft:'#EAF2FF',ink:'#10233F',muted:'#64748B',canvas:'#F7F9FC',white:'#FFFFFF',line:'#DCE6F3'};
export const clamp={extrapolateLeft:'clamp' as const,extrapolateRight:'clamp' as const};
export const ease=Easing.bezier(0,0,0.2,1);
export const reveal=(frame:number,start:number,duration=21)=>interpolate(frame,[start,start+duration],[0,1],{...clamp,easing:ease});
export const BrandImage:React.FC<{width?:number}>=({width=640})=><div className="brand-card" style={{width}}><Img src={staticFile('assets/brand/official/guanheng-group-horizontal-transparent.png')} style={{width:'100%',height:'auto',objectFit:'contain',display:'block'}}/></div>;
export const SceneCanvas:React.FC<{duration:number;children:React.ReactNode;dark?:boolean}>=({duration,children,dark=false})=>{const frame=useCurrentFrame();const opacity=interpolate(frame,[0,10,duration-10,duration],[0,1,1,0],clamp);return <AbsoluteFill className={dark?'scene scene--dark':'scene'} style={{opacity}}><div className="grid"/>{children}</AbsoluteFill>};
export const Eyebrow:React.FC<{children:React.ReactNode}>=({children})=><div className="eyebrow">{children}</div>;
export const SectionIndex:React.FC<{children:React.ReactNode}>=({children})=><div className="section-index">{children}</div>;
