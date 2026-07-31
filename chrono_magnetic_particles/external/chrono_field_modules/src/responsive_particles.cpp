#include "living_field/responsive_particles.hpp"
namespace living_field {
void step_particles(std::vector<ResponsiveParticle>& ps,const std::vector<MagneticNode>& ns,double dt,const ParticleSettings&s){for(auto&p:ps){Vec3 B=DipoleField::combined_field(ns,p.position);
// Relax the moment toward the field *direction*. Lerping toward raw B is inert: in SI
// |B| is ~1e-4 T against a unit-length axis, so the B term gets swamped and the
// moment never turns. Zero field leaves the current orientation untouched.
Vec3 Bhat=normalized(B,p.moment_axis);p.moment_axis=normalized(p.moment_axis+(Bhat-p.moment_axis)*std::clamp(p.susceptibility*dt,0.0,1.0),p.moment_axis);double h=std::max(2*p.radius,1e-4);auto U=[&](Vec3 x){return -p.dipole_moment*dot(p.moment_axis,DipoleField::combined_field(ns,x));};Vec3 grad{(U(p.position-Vec3{h,0,0})-U(p.position+Vec3{h,0,0}))/(2*h),(U(p.position-Vec3{0,h,0})-U(p.position+Vec3{0,h,0}))/(2*h),(U(p.position-Vec3{0,0,h})-U(p.position+Vec3{0,0,h}))/(2*h)};p.velocity+=(grad/std::max(p.mass,1e-12)+s.gravity)*dt;p.velocity*=std::exp(-p.drag*dt);p.velocity=clamp_length(p.velocity,s.max_speed);p.position+=p.velocity*dt;}}
std::vector<MagneticNode> approximate_particle_sources(const std::vector<ResponsiveParticle>&ps,std::uint32_t base){std::vector<MagneticNode> out;out.reserve(ps.size());for(size_t i=0;i<ps.size();++i){MagneticNode n;n.id=base+(uint32_t)i;n.position=ps[i].position;n.magnetic_axis=ps[i].moment_axis;n.dipole_moment=ps[i].dipole_moment;n.externally_driven=true;out.push_back(n);}return out;}
}
