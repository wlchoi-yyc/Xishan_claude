from glb import GLB; import numpy as np
def qmul(a,b):
  x1,y1,z1,w1=a; x2,y2,z2,w2=b
  return np.array([w1*x2+x1*w2+y1*z2-z1*y2, w1*y2-x1*z2+y1*w2+z1*x2, w1*z2+x1*y2-y1*x2+z1*w2, w1*w2-x1*x2-y1*y2-z1*z2])
def qrot(q,v):
  u=np.array(q[:3]); w=q[3]; v=np.array(v,float)
  return v+2*np.cross(u,np.cross(u,v)+w*v)
def qinv(q): return np.array([-q[0],-q[1],-q[2],q[3]])
def qaxis(ax,ang):
  ax=np.array(ax,float); ax/=np.linalg.norm(ax); s=np.sin(ang/2); return np.array([*(ax*s),np.cos(ang/2)])
def world(j):
  par={}
  for i,n in enumerate(j['nodes']):
    for c in n.get('children',[]): par[c]=i
  W={}
  def get(i):
    if i in W: return W[i]
    n=j['nodes'][i]; t=np.array(n.get('translation',[0,0,0]),float); r=np.array(n.get('rotation',[0,0,0,1]),float)
    if i in par: pt,pr=get(par[i]); W[i]=(pt+qrot(pr,t), qmul(pr,r))
    else: W[i]=(t,r)
    return W[i]
  for i in range(len(j['nodes'])): get(i)
  return W,par
