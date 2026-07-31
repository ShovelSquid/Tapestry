#include "living_field/dipole_field.hpp"
#include <iostream>
using namespace living_field;int main(){MagneticNode a,b;a.position={-0.1,0,0};b.position={0.1,0,0};a.magnetic_axis={1,0,0};b.magnetic_axis={1,0,0};auto x=DipoleField::interaction(a,b);std::cout<<"force on A: "<<x.force.x<<' '<<x.force.y<<' '<<x.force.z<<" N\ntorque: "<<x.torque.x<<' '<<x.torque.y<<' '<<x.torque.z<<" Nm\n";}
