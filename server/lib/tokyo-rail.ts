import raw from '../data/tokyo-rail.json';
import { haversine } from '../../shared/fares';
type Point = [number, number];
type Stop = [string, string, number, number, string];
type Edge = [number, number, number, number, Point[]];
const stops = raw.stops as Stop[], edges = raw.edges as Edge[];
const lines = raw.lines as [string, string, string][];
const adjacent: Edge[][] = stops.map(() => []);
for (const edge of edges) adjacent[edge[0]].push(edge);
// Transfers only between platforms assigned to the same parent station by GTFS.
const parents = new Map<string, number[]>();
stops.forEach((s,i) => { if (s[4]) parents.set(s[4], [...(parents.get(s[4]) || []), i]); });
for (const group of parents.values()) for (const a of group) for (const b of group) {
  if (a !== b) adjacent[a].push([a,b,-1,300,[]]);
}
const position = (i:number):Point => [stops[i][2],stops[i][3]];
const distance = (a:Point,b:Point) => haversine(a[0],a[1],b[0],b[1]);
export interface RailSegment { points: Point[]; mode: string; label: string; color?: string; }
export function tokyoRailRoute(from:Point,to:Point) {
  const unavailable = { available: false as const, reason: 'transit_coverage' };
  const nearest = (p:Point) => stops.map((_,i) => ({i,d:distance(p,position(i))})).filter(s=>s.d<=1400).sort((a,b)=>a.d-b.d).slice(0,24);
  const starts=nearest(from), ends=nearest(to);
  if (!starts.length || !ends.length) return unavailable;
  const costs=new Float64Array(stops.length).fill(Infinity);
  const previous=new Map<number,Edge>();
  const heap:[number,number][]=[];
  const push=(value:[number,number])=>{let i=heap.length;heap.push(value);while(i){const p=(i-1)>>1;if(heap[p][0]<=value[0])break;heap[i]=heap[p];i=p;}heap[i]=value;};
  const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1][0]<heap[c][0])c++;if(heap[c][0]>=last[0])break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;};
  for(const s of starts){costs[s.i]=s.d/1.2+300;push([costs[s.i],s.i]);}
  while(heap.length){const [cost,i]=pop();if(cost!==costs[i])continue;for(const edge of adjacent[i]){const next=cost+edge[3];if(next<costs[edge[1]]){costs[edge[1]]=next;previous.set(edge[1],edge);push([next,edge[1]]);}}}
  const candidates=ends.filter(e=>Number.isFinite(costs[e.i])).sort((a,b)=>(costs[a.i]+a.d/1.2)-(costs[b.i]+b.d/1.2));
  // A train selection should include an actual rail segment, not just walking.
  for(const end of candidates){
    const path:Edge[]=[];let i=end.i;
    while(previous.has(i)){const e=previous.get(i)!;path.unshift(e);i=e[0];}
    if(!path.some(e=>e[2]>=0))continue;
    const steps: { line: string; fromStation: string; toStation: string; duration: number }[] = [];
    let lastLine = -1;
    for (const edge of path) {
      if (edge[2] < 0) { lastLine = -1; continue; }
      if (lastLine === edge[2] && steps.length) {
        steps[steps.length - 1].toStation = stops[edge[1]][1];
        steps[steps.length - 1].duration += edge[3];
      } else steps.push({line: lines[edge[2]][1], fromStation: stops[edge[0]][1], toStation: stops[edge[1]][1], duration: edge[3]});
      lastLine = edge[2];
    }
    const segments:RailSegment[]=[];
    const connections:{from:Point;to:Point;label:string}[]=[{from,to:position(i),label:stops[i][1]}];
    for(const e of path){
      if(e[2]<0){connections.push({from:position(e[0]),to:position(e[1]),label:stops[e[1]][1]});continue;}
      const line=lines[e[2]],label=`${line[1]}: ${stops[e[0]][1]} → ${stops[e[1]][1]}`;
      segments.push({points:e[4],mode:'train',label,color:/^[0-9a-f]{6}$/i.test(line[2])?'#'+line[2]:undefined});
    }
    connections.push({from:position(end.i),to,label:stops[end.i][1]});
    const railSeconds=path.reduce((n,e)=>n+e[3],0)+300;
    const railDistance=segments.reduce((n,s)=>n+s.points.slice(1).reduce((d,p,i)=>d+distance(s.points[i],p),0),0);
    const walkDistance=connections.reduce((n,c)=>n+distance(c.from,c.to),0);
    return {available:true as const,mode:'train',segments,connections,
      duration:railSeconds+walkDistance/1.2,distance:railDistance+walkDistance,
      railSeconds,railDistance,estimated:true,steps,source:'tokyo-gtfs',dataDate:raw.downloaded,
      lines:[...new Set(path.filter(e=>e[2]>=0).map(e=>lines[e[2]][1]))],
      stations:[stops[i][1],...path.filter(e=>e[2]<0).map(e=>stops[e[1]][1]),stops[end.i][1]]};
  }
  return unavailable;
}
