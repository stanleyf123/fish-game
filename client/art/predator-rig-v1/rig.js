/* Approved artwork-preserving predator skin rig. No gameplay or saved-data changes. */
(function(){'use strict';
let canvas,gl,program,failed=false,lost=false,textureCache=new WeakMap(),draws=0,textures=0;const U={};
const VS=`precision highp float;attribute vec2 a_uv;uniform float u_time,u_mode,u_kind,u_classic,u_aspect;varying vec2 v_uv;varying float v_fin;
vec2 turn(vec2 p,vec2 root,float a){float c=cos(a),s=sin(a);vec2 d=p-root;return root+vec2(c*d.x-s*d.y,s*d.x+c*d.y);}
void main(){vec2 p=a_uv;float t=u_time,fin=0.;
if(u_kind>1.5){
 float unlocked=1.-smoothstep(.84,.98,a_uv.x),amp=clamp(u_aspect*.035,.06,.12);
 p.y+=sin(t*2.8-a_uv.x*8.)*amp*unlocked;
 p.x+=cos(t*2.8-a_uv.x*8.)*.012*sin(a_uv.x*3.14159)*unlocked;
 float tail=1.-smoothstep(.06,.24,a_uv.x);p=turn(p,vec2(.22,.57),sin(t*2.8-.8)*.12*tail);
}else if(u_kind>.5){
 float tail=1.-smoothstep(.17,.39,a_uv.x);p=turn(p,vec2(.37,.55),sin(t*2.7)*.13*tail);
 float tip=(1.-smoothstep(.07,.23,a_uv.x));p=turn(p,vec2(.20,.43),sin(t*2.7-.8)*.10*tip);
 float rootY=mix(.70,.61,u_classic),frontX=mix(.59,.64,u_classic),rearX=mix(.29,.33,u_classic);
 float front=smoothstep(frontX-.16,frontX-.06,a_uv.x)*(1.-smoothstep(frontX+.13,frontX+.21,a_uv.x))*smoothstep(rootY,rootY+.14,a_uv.y);
 float back=smoothstep(rearX-.15,rearX-.05,a_uv.x)*(1.-smoothstep(rearX+.10,rearX+.17,a_uv.x))*smoothstep(rootY,rootY+.13,a_uv.y);
 p=turn(p,vec2(frontX,rootY),sin(t*2.7-1.0)*.13*front);
 p=turn(p,vec2(rearX,rootY),sin(t*2.7+2.14)*.12*back);
 float far=smoothstep(.73,.80,a_uv.x)*(1.-smoothstep(.88,.94,a_uv.x))*smoothstep(.76,.87,a_uv.y);
 p=turn(p,vec2(.78,.75),sin(t*2.7+1.8)*.075*far);
 p.y+=sin(t*1.6)*.003*exp(-pow((a_uv.x-.57)/.22,2.));fin=front*.035*sin(t*2.7-.7);
}else if(u_mode>.5){
 float tail=1.-smoothstep(.17,.38,p.x);p=turn(p,vec2(.36,.55),sin(t*3.4)*.24*tail);
 float tip=1.-smoothstep(.07,.22,a_uv.x);p=turn(p,vec2(.19,.55),sin(t*3.4-.9)*.22*tip);
 float near=(1.-smoothstep(mix(.64,.66,u_classic),mix(.72,.73,u_classic),a_uv.x))*smoothstep(mix(.30,.34,u_classic),mix(.42,.43,u_classic),a_uv.x)*smoothstep(mix(.63,.59,u_classic),mix(.77,.76,u_classic),a_uv.y);
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
function init(){if(gl&&!lost)return true;if(failed||lost)return false;try{
canvas=document.createElement('canvas');gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true,powerPreference:'low-power'});if(!gl){failed=true;return false}
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true});canvas.addEventListener('webglcontextrestored',()=>{gl=null;lost=false;textureCache=new WeakMap();textures=0});
const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s};
program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,VS));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,FS));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
const uv=[],NX=56,NY=36;for(let y=0;y<NY;y++)for(let x=0;x<NX;x++){const u=x/NX,v=y/NY,U=(x+1)/NX,V=(y+1)/NY;uv.push(u,v,U,v,U,V,u,v,U,V,u,V)}const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(uv),gl.STATIC_DRAW);const at=gl.getAttribLocation(program,'a_uv');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);U.count=uv.length/2;
for(const name of ['time','mode','kind','classic','aspect'])U[name]=gl.getUniformLocation(program,'u_'+name);gl.uniform1i(gl.getUniformLocation(program,'u_art'),0);gl.uniform1f(U.mode,1);gl.clearColor(0,0,0,0);return true;
}catch(e){failed=true;return false}}
function texture(im){let tex=textureCache.get(im);if(tex){gl.bindTexture(gl.TEXTURE_2D,tex);return}tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);for(const [key,val]of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,key,val);textureCache.set(im,tex);textures++}
function draw(ctx,f,s,im,L,Hh,q=1){if(!init())return false;try{
const width=q===0?320:q===1?480:640,aspect=im.naturalWidth/im.naturalHeight,height=Math.max(96,Math.round(width/aspect));if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}gl.viewport(0,0,width,height);gl.useProgram(program);texture(im);gl.clear(gl.COLOR_BUFFER_BIT);
gl.uniform1f(U.time,(f.phase||0)/6);gl.uniform1f(U.kind,s.body==='python'?2:s.body==='crocodile'?1:0);gl.uniform1f(U.classic,/_classic$/.test(f.sp)?1:0);gl.uniform1f(U.aspect,aspect);gl.drawArrays(gl.TRIANGLES,0,U.count);
const pad=.745;ctx.save();try{if(f.sick)ctx.filter='saturate(.45)';ctx.drawImage(canvas,-L/(2*pad),-Hh/(2*pad),L/pad,Hh/pad)}finally{ctx.restore()}draws++;return true;
}catch(e){failed=true;return false}}
window.FFPredatorRig={draw,get available(){return init()},get status(){return{available:!!gl&&!failed&&!lost,draws,textures}},version:'approved-rig-v1'};
})();
