/* PREDATOR-RIG-V8: mesh rig tuned for /art/predator-v8 sprites (facing right, tail at u=0, head at u=1).
   Visual only: no gameplay or saved-data changes. Same API as predator-rig-v1 (window.FFPredatorRig.draw).
   kind 0 = shark: tail-driven travelling wave, caudal fin sweeps from the peduncle, head steady, gentle pectoral.
   kind 1 = crocodilian: slow tail sweep from the hips, legs tucked, almost no body wobble.
   kind 2 = python: smooth travelling sine along the body, head steady. */
(function(){'use strict';
let canvas,gl,program,failed=false,lost=false,textureCache=new WeakMap(),draws=0,textures=0;const U={};
const VS=`precision highp float;attribute vec2 a_uv;uniform float u_time,u_kind;varying vec2 v_uv;
void main(){vec2 p=a_uv;float t=u_time,u=a_uv.x;
if(u_kind>1.5){
 float head=1.-smoothstep(.70,.88,u),tip=.55+.45*(1.-u);
 p.y+=sin(t*1.15-u*7.5)*.075*head*tip;
 p.x+=cos(t*1.15-u*7.5)*.006*head;
}else if(u_kind>.5){
 float w=pow(clamp((.34-u)/.34,0.,1.),1.5);
 p.y+=sin(t*.75-(.34-u)*4.2)*.11*w;
 p.y+=sin(t*.75)*.004*(1.-w);
}else{
 float body=pow(clamp((.62-u)/.62,0.,1.),1.6),wave=sin(t*1.05-u*3.4);
 p.y+=wave*.09*body;
 float fin=1.-smoothstep(.14,.22,u);
 vec2 root=vec2(.19,.5);float sw=sin(t*1.05-.95);
 p.x=root.x+(p.x-root.x)*(1.-fin*(.10+.10*sw*sw));
 p.y+=fin*sw*.07;
 float pec=smoothstep(.50,.56,u)*(1.-smoothstep(.70,.76,u))*smoothstep(.64,.74,a_uv.y);
 vec2 pr=vec2(.58,.66),d=p-pr;float a=sin(t*1.05+1.2)*.07*pec,c=cos(a),s=sin(a);p=pr+vec2(c*d.x-s*d.y,s*d.x+c*d.y);
}
vec2 clip=(p-vec2(.5))*vec2(1.49,-1.49);gl_Position=vec4(clip,0.,1.);v_uv=a_uv;}`;
const FS=`precision mediump float;uniform sampler2D u_art;varying vec2 v_uv;void main(){gl_FragColor=texture2D(u_art,v_uv);}`;
function init(){if(gl&&!lost)return true;if(failed||lost)return false;try{
canvas=document.createElement('canvas');gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true,powerPreference:'low-power'});if(!gl){failed=true;return false}
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true});canvas.addEventListener('webglcontextrestored',()=>{gl=null;lost=false;textureCache=new WeakMap();textures=0});
const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s};
program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,VS));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,FS));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
const uv=[],NX=72,NY=24;for(let y=0;y<NY;y++)for(let x=0;x<NX;x++){const u=x/NX,v=y/NY,U2=(x+1)/NX,V2=(y+1)/NY;uv.push(u,v,U2,v,U2,V2,u,v,U2,V2,u,V2)}const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(uv),gl.STATIC_DRAW);const at=gl.getAttribLocation(program,'a_uv');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);U.count=uv.length/2;
for(const name of ['time','kind'])U[name]=gl.getUniformLocation(program,'u_'+name);gl.uniform1i(gl.getUniformLocation(program,'u_art'),0);gl.clearColor(0,0,0,0);return true;
}catch(e){failed=true;return false}}
function texture(im){let tex=textureCache.get(im);if(tex){gl.bindTexture(gl.TEXTURE_2D,tex);return}tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);for(const [key,val]of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,key,val);textureCache.set(im,tex);textures++}
function draw(ctx,f,s,im,L,Hh,q=1){if(!init())return false;try{
const width=q===0?384:q===1?512:768,aspect=im.naturalWidth/im.naturalHeight,height=Math.max(64,Math.round(width/aspect));if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}gl.viewport(0,0,width,height);gl.useProgram(program);texture(im);gl.clear(gl.COLOR_BUFFER_BIT);
gl.uniform1f(U.time,(f.phase||0)*.3);gl.uniform1f(U.kind,s.body==='python'?2:s.body==='crocodile'?1:0);gl.drawArrays(gl.TRIANGLES,0,U.count);
const pad=.745;ctx.save();try{if(f.sick)ctx.filter='saturate(.45)';ctx.drawImage(canvas,-L/(2*pad),-Hh/(2*pad),L/pad,Hh/pad)}finally{ctx.restore()}draws++;return true;
}catch(e){failed=true;return false}}
window.FFPredatorRig={draw,get available(){return init()},get status(){return{available:!!gl&&!failed&&!lost,draws,textures}},version:'predator-rig-v8'};
})();
