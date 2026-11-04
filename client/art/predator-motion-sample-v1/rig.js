/* Artwork-preserving two-dimensional skin rig; an animation sample, not a 3D model. */
(function(){'use strict';
const VS=`precision highp float;attribute vec2 a_uv;uniform float u_time,u_mode;varying vec2 v_uv;varying float v_fin;
vec2 turn(vec2 p,vec2 root,float a){float c=cos(a),s=sin(a);vec2 d=p-root;return root+vec2(c*d.x-s*d.y,s*d.x+c*d.y);}
void main(){vec2 p=a_uv;float t=u_time,fin=0.;
if(u_mode>.5){
 float tail=1.-smoothstep(.17,.38,p.x);p=turn(p,vec2(.36,.55),sin(t*3.4)*.24*tail);
 float tip=1.-smoothstep(.07,.22,a_uv.x);p=turn(p,vec2(.19,.55),sin(t*3.4-.9)*.22*tip);
 float near=(1.-smoothstep(.64,.72,a_uv.x))*smoothstep(.30,.42,a_uv.x)*smoothstep(.63,.77,a_uv.y);
 p=turn(p,vec2(.66,.64),sin(t*3.4-1.1)*.20*near);
 float dorsal=smoothstep(.40,.47,a_uv.x)*(1.-smoothstep(.69,.75,a_uv.x))*(1.-smoothstep(.23,.37,a_uv.y));
 p=turn(p,vec2(.65,.30),sin(t*3.4+.7)*.075*dorsal);
 float rear=smoothstep(.74,.81,a_uv.x)*smoothstep(.74,.88,a_uv.y);
 p=turn(p,vec2(.79,.76),sin(t*3.4+1.2)*.12*rear);
 float body=exp(-pow((a_uv.x-.61)/.19,2.));p.y+=sin(t*2.0)*.004*body;
 float depth=near*sin(t*3.4-1.1)*.055+rear*sin(t*3.4+1.2)*.025;
 p=vec2(.66,.64)+(p-vec2(.66,.64))*(1.+depth);fin=near*.055*sin(t*3.4-.9);
}else{float w=pow(1.-a_uv.x,2.2);p.y+=sin(t*6.-a_uv.x*5.4)*.0825*w;}
// Preserve the painted character, with padding for articulated fins and tail.
vec2 clip=(p-vec2(.5))*vec2(1.49,-1.49);gl_Position=vec4(clip,0.,1.);v_uv=a_uv;v_fin=fin;}`;
const FS=`precision mediump float;uniform sampler2D u_art;varying vec2 v_uv;varying float v_fin;void main(){vec4 c=texture2D(u_art,v_uv);gl_FragColor=vec4(c.rgb*(1.+v_fin),c.a);}`;
window.SharkRigSample=function(canvas,img){const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true});if(!gl)throw Error('此瀏覽器無法播放此動作樣本');
const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,VS));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,FS));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
const uv=[];const NX=56,NY=36;for(let y=0;y<NY;y++)for(let x=0;x<NX;x++){const u=x/NX,v=y/NY,U=(x+1)/NX,V=(y+1)/NY;uv.push(u,v,U,v,U,V,u,v,U,V,u,V)}const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(uv),gl.STATIC_DRAW);const at=gl.getAttribLocation(p,'a_uv');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);
const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
const time=gl.getUniformLocation(p,'u_time'),mode=gl.getUniformLocation(p,'u_mode');gl.uniform1i(gl.getUniformLocation(p,'u_art'),0);gl.clearColor(0,0,0,0);
return function(t,newMode){gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform1f(time,t);gl.uniform1f(mode,newMode?1:0);gl.drawArrays(gl.TRIANGLES,0,uv.length/2);};
};})();
