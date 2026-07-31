#include "living_field/responsive_particles.hpp"
#include <iostream>
using namespace living_field;int main(){std::vector<MagneticNode>n(1);n[0].dipole_moment=5;std::vector<ResponsiveParticle>p(1);p[0].position={.2,.1,0};for(int i=0;i<600;++i)step_particles(p,n,1.0/240.0);std::cout<<p[0].position.x<<' '<<p[0].position.y<<' '<<p[0].position.z<<"\n";}
