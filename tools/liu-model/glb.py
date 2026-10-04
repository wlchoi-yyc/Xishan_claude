import json, struct, numpy as np
CT={5120:np.int8,5121:np.uint8,5122:np.int16,5123:np.uint16,5125:np.uint32,5126:np.float32}
NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
class GLB:
  def __init__(s,path):
    b=open(path,'rb').read(); jl=struct.unpack('<I',b[12:16])[0]
    s.j=json.loads(b[20:20+jl]); o=20+jl; bl=struct.unpack('<I',b[o:o+4])[0]; s.bin=bytearray(b[o+8:o+8+bl])
  def acc(s,i):
    a=s.j['accessors'][i]; bv=s.j['bufferViews'][a['bufferView']]; dt=CT[a['componentType']]; n=NC[a['type']]
    off=bv.get('byteOffset',0)+a.get('byteOffset',0); st=bv.get('byteStride',0); isz=np.dtype(dt).itemsize*n
    if st and st!=isz:
      raw=np.frombuffer(bytes(s.bin[off:off+st*a['count']]),dtype=np.uint8).reshape(a['count'],st)[:,:isz].copy()
      arr=raw.view(dt).reshape(a['count'],n)
    else: arr=np.frombuffer(bytes(s.bin[off:off+isz*a['count']]),dtype=dt).reshape(a['count'],n).copy()
    if a.get('normalized'): arr=arr.astype(np.float32)/np.iinfo(dt).max
    return arr
