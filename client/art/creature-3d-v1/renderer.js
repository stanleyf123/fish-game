/* FeedFish creature volume renderer. Procedural rounded meshes, depth testing,
   lit surfaces, articulated fins/legs, continuous body bending and real yaw. */
(function(){
'use strict';
const TYPES={s_great_white:0,s_hammerhead:1,s_tiger:2,r_saltwater_croc:3,r_nile_croc:4,r_spectacled_caiman:5,r_reticulated_python:6};
const base=id=>String(id).replace(/_classic$/,'');
const handles=id=>Object.prototype.hasOwnProperty.call(TYPES,base(id));
let gl=null,canvas=null,program=null,failed=false,lost=false;const models=new Map(),thumbs=new Map(),U={},A={};
const VSH=`precision highp float;
attribute vec3 a_pos,a_normal;attribute float a_mat,a_part;attribute vec3 a_color;
uniform float u_time,u_kind,u_yaw,u_span,u_variant;
varying vec3 v_normal,v_pos,v_color;varying float v_mat;
vec3 deform(vec3 p,float part){
 float t=u_time;
 if(u_kind>5.5){float k=clamp((1.95-p.x)/4.1,0.,1.);p.z+=sin(t*1.05-p.x*2.5)*(.12+.23*k);p.y+=sin(t*.78-p.x*2.4)*(.12+.24*sqrt(k))*(1.-smoothstep(1.5,2.4,p.x));}
 else {float k=clamp((.4-p.x)/2.1,0.,1.);p.z+=sin(t*1.15+p.x*2.8)*k*k*(u_kind>2.5?.24:.29);p.y+=sin(t*.6+p.x)*.018;
 if(part>0.5&&part<2.5){float side=part<1.5?1.:-1.;float reach=max(0.,abs(p.z)-.23);p.y+=sin(t*.7+side*.7)*reach*.17;}
 if(part>2.5&&part<6.5){float side=mod(part,2.)<.5?1.:-1.;float reach=max(0.,abs(p.z)-.3);p.x+=sin(t*.63+part*1.6)*reach*.18;p.y+=cos(t*.63+part*1.6)*reach*.10;}}
 return p;
}
vec3 rotateView(vec3 p){float c=cos(u_yaw),s=sin(u_yaw);p=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);float cp=cos(.12),sp=sin(.12);return vec3(p.x,cp*p.y-sp*p.z,sp*p.y+cp*p.z);}
void main(){
 vec3 p=deform(a_pos,a_part);
 // Deformation-aware normal: evaluate two local tangent directions.
 vec3 n=normalize(a_normal),ref=abs(n.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.);
 vec3 t1=normalize(cross(n,ref)),t2=cross(n,t1);
 vec3 n2=normalize(cross(deform(a_pos+t1*.006,a_part)-p,deform(a_pos+t2*.006,a_part)-p));
 vec3 q=rotateView(p);v_normal=rotateView(n2);v_pos=a_pos;v_mat=a_mat;v_color=a_color;
 float perspective=1./(1.-q.z*.075);gl_Position=vec4(q.x/u_span*perspective,q.y/(u_span*.5)*perspective,-q.z*.12,1.);
}`;
const FSH=`precision highp float;
varying vec3 v_normal,v_pos,v_color;varying float v_mat;
uniform float u_variant,u_kind,u_time;
void main(){
 vec3 n=normalize(v_normal);if(n.z<0.)n=-n;vec3 light=normalize(vec3(-.45,.9,1.1)),view=vec3(0.,0.,1.);
 float diff=max(dot(n,light),0.),wrap=clamp((dot(n,light)+.38)/1.38,0.,1.);
 vec3 color=v_color;float gloss=38.,spec=.28;
 if(v_mat<1.5){
  float belly=(1.-smoothstep(-.22,.035,v_pos.y));
  color=mix(color,vec3(.93,.96,.91),belly*.94);
  float a=atan(v_pos.z,v_pos.y);
  if(u_variant>.5){
   vec3 special=u_kind<2.5?vec3(.055,.31,.49):u_kind>5.5?vec3(.64,.34,.055):vec3(.25,.40,.17);
   if(u_kind>2.5&&u_kind<4.5)special=vec3(.48,.31,.09);
   color=mix(color,special,.7*(1.-belly*.5));
   float curl=sin(v_pos.x*7.+a*2.+sin(v_pos.x*4.-a*2.)*1.9);
   float filigree=1.-smoothstep(.045,.17,abs(curl));
   vec3 pearl=u_kind<2.5?vec3(.76,.94,.98):vec3(1.,.77,.31);
   color=mix(color,pearl,filigree*.8*(1.-belly*.65));gloss=52.;spec=.38;
  }else{
   if(u_kind>1.5&&u_kind<2.5){float bars=1.-smoothstep(.18,.43,abs(sin(v_pos.x*8.+a*.65)));color*=1.-bars*.38*(1.-belly);}
   if(u_kind>5.5){float net=pow(abs(sin(v_pos.x*9.+a*2.8)*sin(v_pos.x*9.-a*2.8)),2.);color=mix(color,vec3(.19,.105,.04),net*.7);}
   if(u_kind>2.5&&u_kind<5.5){float scales=abs(sin(v_pos.x*22.+a*4.)*sin(a*11.));color*=.84+.16*scales;}
  }
 }else if(v_mat>2.5&&v_mat<5.5){gloss=80.;spec=.43;}
 float sheen=pow(max(dot(n,normalize(light+view)),0.),gloss);
 float rim=pow(1.-max(dot(n,view),0.),3.);float soft=pow(max(dot(n,normalize(vec3(-.6,.65,1.5))),0.),8.);
 float underside=.77+.23*smoothstep(-.6,.3,v_pos.y);
 vec3 lit=color*(.42+.70*wrap)*underside+vec3(.78,.9,1.)*sheen*spec+vec3(.30,.53,.60)*rim*.09+vec3(.66,.81,.89)*soft*.09;
 if(v_mat>5.5&&v_mat<6.5)lit=color;
 gl_FragColor=vec4(lit,1.);
}`;
function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
function init(){if(gl&&!lost)return true;if(failed||lost)return false;try{
 canvas=document.createElement('canvas');canvas.width=640;canvas.height=320;
 gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true,powerPreference:'low-power'});if(!gl){failed=true;return false;}
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;});canvas.addEventListener('webglcontextrestored',()=>{gl=null;lost=false;models.clear();thumbs.clear();});
 program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,VSH));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,FSH));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 for(const k of ['time','kind','yaw','span','variant'])U[k]=gl.getUniformLocation(program,'u_'+k);for(const k of ['pos','normal','color','mat','part'])A[k]=gl.getAttribLocation(program,'a_'+k);
 gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);return true;
 }catch(e){failed=true;console.warn('[creature3d] volume renderer unavailable; retained illustration fallback',e.message);return false;}}
const norm=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n);},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],sub=(a,b)=>a.map((v,i)=>v-b[i]);
function builder(){const data=[];function vert(p,n,col,mat=0,part=0){data.push(...p,...n,...col,mat,part)}
 function tri(a,b,c,col,mat=0,part=0){const n=norm(cross(sub(b,a),sub(c,a)));vert(a,n,col,mat,part);vert(b,n,col,mat,part);vert(c,n,col,mat,part)}
 function sphere(cx,cy,cz,rx,ry,rz,col,mat=0,part=0,rows=12,cols=20){
 const at=(i,j)=>{const th=i/rows*Math.PI,ph=j/cols*Math.PI*2,unit=[Math.sin(th)*Math.cos(ph),Math.cos(th),Math.sin(th)*Math.sin(ph)];return {p:[cx+unit[0]*rx,cy+unit[1]*ry,cz+unit[2]*rz],n:norm([unit[0]/rx,unit[1]/ry,unit[2]/rz])}};
 for(let i=0;i<rows;i++)for(let j=0;j<cols;j++){const a=at(i,j),b=at(i+1,j),c=at(i+1,j+1),d=at(i,j+1);for(const q of [a,b,c,a,c,d])vert(q.p,q.n,col,mat,part)}
 }
 function tube(points,col,mat=0,ratio=1,radial=18){
 for(let i=0;i<points.length-1;i++)for(let j=0;j<radial;j++){
 const at=(k,jj)=>{const p=points[k],a=jj/radial*Math.PI*2,b=points[Math.max(0,k-1)],e=points[Math.min(points.length-1,k+1)],dr=(e[1]-b[1])/(e[0]-b[0]||1);return{p:[p[0],Math.cos(a)*p[1],Math.sin(a)*p[1]*ratio],n:norm([-dr,Math.cos(a),Math.sin(a)/ratio])}};
 const a=at(i,j),b=at(i+1,j),c=at(i+1,j+1),d=at(i,j+1);for(const q of [a,c,b,a,d,c])vert(q.p,q.n,col,mat,0);
 }}
 function fin(a,tip,b,col,part=0,thickness=.035){
 const n=norm(cross(sub(tip,a),sub(b,a))),N=7;
 const at=(u,v,side)=>{const root=a.map((x,k)=>x+(b[k]-x)*u),p=root.map((x,k)=>x*(1-v)+tip[k]*v),bulge=Math.sin(Math.PI*u)*Math.sin(Math.PI*v)*thickness*side;return p.map((x,k)=>x+n[k]*bulge)};
 for(const side of [-1,1])for(let i=0;i<N;i++)for(let j=0;j<N;j++){
 const u=i/N,v=j/N,A=at(u,v,side),B=at(u+1/N,v,side),C=at(u+1/N,v+1/N,side),D=at(u,v+1/N,side);
 for(const q of [A,B,C,A,C,D]){const uu=(q===B||q===C)?u+1/N:u,vv=(q===C||q===D)?v+1/N:v;const nn=norm(cross(sub(at(uu+.001,vv,side),q),sub(at(uu,vv+.001,side),q)));vert(q,nn.map(x=>x*side),col,1,part)}
 }}
 function cone(x,y,z,r,h,col,axis=1){const N=12;for(let i=0;i<N;i++){const a=i/N*Math.PI*2,b=(i+1)/N*Math.PI*2;tri([x+Math.cos(a)*r,y,z+Math.sin(a)*r],[x,y+h*axis,z],[x+Math.cos(b)*r,y,z+Math.sin(b)*r],col,2)}}
 return{data,vert,tri,sphere,tube,fin,cone};}
function make(kind,variant){const b=builder(),body=kind<3?[.32,.49,.62]:kind===3?[.29,.34,.20]:kind===4?[.45,.39,.15]:kind===5?[.27,.46,.18]:[.53,.36,.13],fin=body.map(x=>x*.91),dark=[.035,.065,.073],white=[.95,.95,.84];
 function eye(x,y,z,r,iris=[.17,.55,.65]){
 const side=Math.sign(z)||1;
 b.sphere(x,y,z,r*1.16,r*1.13,r*.75,fin,0,0,10,16);
 b.sphere(x+.015,y+.006,z+side*r*.36,r,r,r*.65,white,3,0,12,20);
 b.sphere(x+.035,y-.003,z+side*r*.83,r*.63,r*.72,r*.24,iris,4,0,10,18);
 b.sphere(x+.045,y-.003,z+side*r*.99,r*.31,r*.53,r*.12,dark,5,0,10,16);
 b.sphere(x+.018,y+r*.30,z+side*r*1.09,r*.21,r*.21,r*.04,[1,1,1],6,0,8,12);
 }
 if(kind<3){
 const points=[[-1.48,.025],[-1.30,.075],[-1.05,.13],[-.80,.23],[-.5,.34],[-.15,.415],[.2,.46],[.52,.43],[.82,.34],[1.05,.23],[1.20,.12],[1.26,.025]];b.tube(points,body,0,.88,28);b.sphere(1.025,-.018,0,.275,.205,.23,body,0,0,14,24);
 b.sphere(1.0,-.16,0,.245,.115,.185,[.91,.94,.88],2,0,14,24);
 const ex=variant?1.16:1;
 b.fin([-.35,.36,0],[-.26,.98*ex,-.025],[.33,.38,0],fin,0,.06);
 b.fin([-1.28,.04,0],[-1.82,.76*ex,.01],[-1.49,-.03,0],fin,0,.05);
 b.fin([-1.49,.01,0],[-1.79,-.49*ex,.01],[-1.28,-.03,0],fin,0,.04);
 for(const side of [-1,1]){b.fin([.32,-.12,side*.27],[-.27,-.46,side*.92*ex],[-.34,-.17,side*.26],fin,side>0?1:2,.07);b.fin([-.55,-.12,side*.16],[-.85,-.28,side*.40],[-.82,-.08,side*.14],fin,0,.03)}
 if(kind===1){b.sphere(.92,.04,0,.33,.21,.72,body,0);b.sphere(1.14,.015,0,.17,.12,.63,body,0);for(const side of [-1,1])eye(.99,.14,side*.63,.14,[.25,.64,.68]);}
 else for(const side of [-1,1]){eye(.78,.145,side*.24,.12,kind===2?[.78,.48,.10]:[.18,.48,.65]);b.sphere(.76,.233,side*.265,.145,.045,.07,body,0,0,10,16);}
 // Sculpted dark smile and individual ivory teeth, visible on near and far sides.
 for(const side of [-1,1]){b.sphere(1.035,-.105,side*.205,.17,.055,.065,[.22,.115,.12],2,0,10,18);for(let j=0;j<4;j++)b.cone(.94+j*.055,-.085,side*.269,.022,.052,white,-1);
 for(let j=0;j<4;j++)b.sphere(.43-j*.055,.015,side*(.335+j*.012),.011,.078,.012,[.09,.16,.19],2,0,8,10);}
 }else if(kind<6){
 b.tube([[-2.20,.008],[-2.01,.06],[-1.75,.12],[-1.43,.19],[-1.1,.24],[-.7,.33],[-.2,.39],[.3,.37],[.7,.28],[.98,.20]],body,0,1.15,22);
 const snout=kind===3?.54:kind===4?.64:.39,wide=kind===3?.34:kind===4?.25:.26;
 b.sphere(.90,.035,0,.48,.29,.36,body,0);
 b.sphere(1.42,-.085,0,snout,.17,wide,body,0);
 b.sphere(1.43,-.22,0,snout*.98,.075,wide*.94,[.64,.61,.35],2);
 for(const side of [-1,1]){eye(.91,.25,side*.27,.105,kind===5?[.85,.59,.09]:[.72,.48,.13]);b.sphere(.90,.326,side*.25,.145,.044,.095,body,0,0,10,16);b.sphere(1.42+snout*.72,.075,side*wide*.55,.045,.035,.045,dark,2,0,8,12);
 for(let j=0;j<7;j++)b.cone(1.03+j*(snout*1.4/7),-.155,side*wide*.88,.024,.065,white,-1);
 for(const x of [-.62,.43]){const part=(x<0?3:5)+(side<0?1:0);b.sphere(x,-.15,side*.43,.24,.17,.28,body,0,part);b.sphere(x-.16,-.24,side*.65,.25,.095,.20,body,0,part);for(let j=0;j<3;j++)b.sphere(x-.34+j*.085,-.27,side*.74,.055,.035,.07,white,2,part,8,12);}}
 for(let j=0;j<13;j++){const x=-1.92+j*.20,r=.04+.045*(1-Math.abs(x+.15)/2.2);b.cone(x,.10+Math.max(0,1-Math.abs(x)/2.1)*.25,0,Math.max(.035,r),variant?.22:.12,variant?[.77,.59,.22]:fin);}
 // Raised dorsal scales cast their own changing highlights.
 for(let row=0;row<3;row++)for(let j=0;j<7;j++){const x=-.83+j*.23,z=(row-1)*.20;b.sphere(x,.30-Math.abs(z)*.23,z,.09,.055,.07,body.map(v=>v*1.07),0,0,6,10);}
 }else{
 const points=[];for(let i=0;i<=56;i++){const u=i/56;let r=.15*Math.pow(Math.sin(Math.PI*u/2),.65);if(u>.88)r*=1-(u-.88)*3;points.push([-2.5+4.65*u,Math.max(.008,r)])}b.tube(points,body,0,1.05,22);
 b.sphere(2.04,.015,0,.25,.19,.20,body,0);b.sphere(2.20,-.045,0,.19,.10,.16,body,0);
 for(const side of [-1,1]){eye(2.09,.13,side*.13,.085,[.85,.59,.14]);b.sphere(2.30,.015,side*.07,.022,.018,.018,dark,2,0,6,10);b.sphere(2.22,-.08,side*.15,.16,.013,.012,dark,2,0,6,12);}
 }
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(b.data),gl.STATIC_DRAW);return {buffer,count:b.data.length/11,span:kind>5?2.82:kind>2?2.52:2.12};}
function pose(f){const now=typeof performance!=='undefined'?performance.now():Date.now(),dt=Math.min(.08,Math.max(0,(now-(f._c3at??now))/1000));f._c3at=now;const target=f.face===-1?Math.PI-.24:.24;let y=f._c3yaw??target,delta=Math.atan2(Math.sin(target-y),Math.cos(target-y));y+=delta*(1-Math.exp(-dt*5.5));f._c3yaw=y;return y;}
function paint(f){if(!init())return false;const kind=TYPES[base(f.sp)],variant=/_classic$/.test(f.sp)?0:1,key=kind+'|'+variant;let model=models.get(key);if(!model){model=make(kind,variant);models.set(key,model)}
 gl.useProgram(program);gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.bindBuffer(gl.ARRAY_BUFFER,model.buffer);
 for(const [name,size,offset]of [['pos',3,0],['normal',3,3],['color',3,6],['mat',1,9],['part',1,10]]){const at=A[name];if(at>=0){gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,size,gl.FLOAT,false,44,offset*4)}}
 gl.uniform1f(U.time,f.phase||0);gl.uniform1f(U.kind,kind);gl.uniform1f(U.variant,variant);gl.uniform1f(U.span,model.span);gl.uniform1f(U.yaw,pose(f));gl.drawArrays(gl.TRIANGLES,0,model.count);return true;
}
function draw(c,f,s){if(!handles(f.sp)||!paint(f))return false;const L=s.len*(TYPES[base(f.sp)]===6?2.5:1.72);c.save();if(f.sick)c.filter='saturate(.45)';c.drawImage(canvas,-L/2,-L/4,L,L/2);c.restore();return true;}
function preview(sp){if(!handles(sp)||!init())return null;if(thumbs.has(sp))return thumbs.get(sp);if(!paint({sp,face:1,phase:.35}))return null;const c=document.createElement('canvas');c.width=320;c.height=160;c.getContext('2d').drawImage(canvas,0,0,320,160);const url=c.toDataURL('image/png');thumbs.set(sp,url);return url;}
window.FFCreature3D={handles,draw,preview,get available(){return init()},get status(){return {available:!!gl&&!lost&&!failed,models:models.size,contextLost:lost}},version:'volume-v1'};
})();
