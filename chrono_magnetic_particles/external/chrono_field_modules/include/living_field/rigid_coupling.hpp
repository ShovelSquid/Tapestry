#pragma once
#include "dipole_field.hpp"
#include <vector>
namespace living_field {
struct RigidSettings { double linear_damping{0.1},angular_damping{0.1},max_speed{10},max_spin_rad_s{1000}; bool integrate_driven_rotation{false}; };
void step_rigid_nodes(std::vector<MagneticNode>& nodes,double dt,const RigidSettings& settings={});
}
