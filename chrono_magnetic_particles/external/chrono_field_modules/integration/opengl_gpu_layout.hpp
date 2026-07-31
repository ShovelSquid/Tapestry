#pragma once
// std430-compatible packet for the existing compute shader. Convert double CPU
// state to floats only at the GPU boundary.
#include "living_field/types.hpp"
namespace living_field { struct alignas(16) GpuMagneticNode { float px,py,pz,radius; float mx,my,mz,strength; }; inline GpuMagneticNode to_gpu(const MagneticNode&n){return{(float)n.position.x,(float)n.position.y,(float)n.position.z,(float)n.radius,(float)n.magnetic_axis.x,(float)n.magnetic_axis.y,(float)n.magnetic_axis.z,(float)n.dipole_moment};}}
