"use strict";
function render(ctx,width,height,spec){
 ctx.clearRect(0,0,width,height);ctx.font="10px sans-serif";ctx.lineWidth=1;ctx.textBaseline="middle";
 const left=36,right=spec.kind==="monthly"?width-83:width-12,top=25,bottom=height-28,max=spec.max||100,x=value=>left+value/max*(right-left),label=(text,x,y,align="left",color="#70859a")=>{ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(String(text),x,y);},line=(x1,y1,x2,y2,color="#e1e9ef",dash=[])=>{ctx.beginPath();ctx.setLineDash(dash);ctx.strokeStyle=color;ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.setLineDash([]);};
 const step=max>300?100:50;
 for(let value=0;value<=max;value+=step){line(x(value),top,x(value),bottom);label(value,x(value),spec.kind==="monthly"?12:height-12,"center");}
 if(spec.kind==="monthly"){
  const rows=spec.rows||[],gap=(bottom-top)/Math.max(1,rows.length);label("Δ / 天数",right+12,12);
  rows.forEach((row,i)=>{const y=top+(i+.5)*gap;label(row.label,1,y);if(!row.count){label("—",left,y);return;}ctx.lineWidth=3;line(x(row.a),y,x(row.b),y,"#b7c6d1");ctx.lineWidth=1;[[row.a,"#236c9b"],[row.b,"#c56635"]].forEach(([v,c])=>{ctx.beginPath();ctx.fillStyle=c;ctx.arc(x(v),y,3.5,0,2*Math.PI);ctx.fill();});label(row.delta+" / "+row.count,right+10,y);});return;
 }
 const y=value=>bottom-value*(bottom-top);ctx.fillStyle="#f2f7f0";ctx.fillRect(left,top,Math.max(0,x(Math.min(50,max))-left),bottom-top);
 for(const fraction of [0,.25,.5,.75,1]){line(left,y(fraction),right,y(fraction));label(Math.round(fraction*100)+"%",left-7,y(fraction),"right");}
 for(const value of [50,100])if(value<=max){line(x(value),top,x(value),bottom,"#bccbd5",[4,4]);label(value,x(value)+4,top+9);}
 if(spec.threshold!==undefined&&spec.threshold<=max)line(x(spec.threshold),top,x(spec.threshold),bottom,"#385a70",[3,3]);
 (spec.series||[]).forEach(series=>{const points=series.points||[];if(points.length<2)return;ctx.globalAlpha=(spec.focus&&spec.focus!==series.key)?0.15:1;ctx.beginPath();ctx.strokeStyle=series.color;ctx.lineWidth=spec.focus===series.key?2.7:1.7;points.forEach((point,i)=>i?ctx.lineTo(x(point.x),y(point.y)):ctx.moveTo(x(point.x),y(point.y)));ctx.lineTo(right,y(points[points.length-1].y));ctx.stroke();ctx.globalAlpha=1;});ctx.lineWidth=1;
}
module.exports={render};
