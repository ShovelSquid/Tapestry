#pragma once
// Adapter sketch: keep Chrono optional. Call DipoleField::interaction for every
// node pair, then apply result.force and result.torque to matching ChBody objects.
// Exact Chrono API calls depend on the Chrono version used by the parent project.
#include "living_field/dipole_field.hpp"
namespace living_field::chrono_adapter {
template<class ApplyForce,class ApplyTorque>
void apply_pair(const MagneticNode&a,const MagneticNode&b,ApplyForce force,ApplyTorque torque){auto ab=DipoleField::interaction(a,b);auto ba=DipoleField::interaction(b,a);force(a.id,ab.force);force(b.id,ba.force);torque(a.id,ab.torque);torque(b.id,ba.torque);}
}
