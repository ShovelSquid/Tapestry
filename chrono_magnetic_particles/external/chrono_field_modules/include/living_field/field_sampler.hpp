#pragma once
#include "dipole_field.hpp"
#include <vector>
namespace living_field {
struct GridSpec { Vec3 min{-1,-1,-1},max{1,1,1}; int nx{16},ny{16},nz{16}; };
std::vector<FieldSample> sample_volume(const std::vector<MagneticNode>& nodes,const GridSpec& grid);
}
