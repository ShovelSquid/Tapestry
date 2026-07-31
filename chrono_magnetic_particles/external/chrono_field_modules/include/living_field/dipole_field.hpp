#pragma once
#include "types.hpp"
#include <span>
namespace living_field {
class DipoleField { public:
 static Vec3 field_at(const MagneticNode& source,Vec3 point,double softening_m=1e-4);
 static Vec3 combined_field(std::span<const MagneticNode> nodes,Vec3 point,double softening_m=1e-4);
 // Returns the force AND torque acting on `a` due to `b` -- both refer to the same
 // body. For the reaction on `b`, negate the force (Newton's third law); its torque
 // needs interaction(b,a), as dipole torques are not equal and opposite in general.
 static ForceTorque interaction(const MagneticNode& a,const MagneticNode& b,double softening_m=1e-4);
};
}
