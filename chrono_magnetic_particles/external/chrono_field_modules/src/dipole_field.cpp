#include "living_field/dipole_field.hpp"
namespace living_field { static constexpr double mu0_over_4pi=1e-7;
Vec3 DipoleField::field_at(const MagneticNode&s,Vec3 p,double eps){Vec3 r=p-s.position;double r2=length2(r)+eps*eps;double d=std::sqrt(r2);Vec3 rh=r/d,m=normalized(s.magnetic_axis)*s.dipole_moment;return mu0_over_4pi*(3*rh*dot(m,rh)-m)/(r2*d);}
Vec3 DipoleField::combined_field(std::span<const MagneticNode> ns,Vec3 p,double e){Vec3 out{};for(auto&n:ns)out+=field_at(n,p,e);return out;}
// Both returned quantities act on `a`. The standard bracket below is written with
// rh pointing a->b, which yields the force on `b`; negate it to get the force on `a`.
ForceTorque DipoleField::interaction(const MagneticNode&a,const MagneticNode&b,double eps){Vec3 r=b.position-a.position;double r2=length2(r)+eps*eps,d=std::sqrt(r2);Vec3 rh=r/d,ma=normalized(a.magnetic_axis)*a.dipole_moment,mb=normalized(b.magnetic_axis)*b.dipole_moment;double c=3*mu0_over_4pi/(r2*r2);Vec3 f_on_b=c*(dot(ma,rh)*mb+dot(mb,rh)*ma+dot(ma,mb)*rh-5*dot(ma,rh)*dot(mb,rh)*rh);Vec3 B=field_at(b,a.position,eps);return{-f_on_b,cross(ma,B)};}
}
