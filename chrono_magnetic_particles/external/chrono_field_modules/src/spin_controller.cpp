#include "living_field/spin_controller.hpp"
namespace living_field {
double SpinController::radians_per_second(double hz){return 2*pi*hz;}
double SpinController::rpm(double hz){return 60*hz;}
Vec3 SpinController::commanded_axis(const SpinProgram& p,double t){double phase=p.phase_rad+2*pi*(p.frequency_hz*t+0.5*p.frequency_rate_hz_per_s*t*t); Vec3 spin=normalized(p.axis); Vec3 seed=std::abs(dot(spin,Vec3{0,1,0}))<0.95?Vec3{0,1,0}:Vec3{1,0,0}; Vec3 radial=normalized(cross(spin,seed)); Vec3 transverse=normalized(rotate_axis_angle(radial,p.axis,phase));
 // amplitude is the transverse fraction: 1 sweeps the full equator (the default), 0 pins the
 // moment to the spin axis, and values between trace a cone of half-angle asin(amplitude).
 double amp=std::clamp(p.amplitude,0.0,1.0); return normalized(transverse*amp+spin*std::sqrt(std::max(0.0,1-amp*amp)),spin);}
void SpinController::apply(MagneticNode& n,double t,double){n.magnetic_axis=commanded_axis(n.drive,t);n.angular_velocity=normalized(n.drive.axis)*radians_per_second(n.drive.frequency_hz+n.drive.frequency_rate_hz_per_s*t);}
void SpinController::slew_frequency(SpinProgram& p,double target,double max_rate,double dt){double d=std::clamp(target-p.frequency_hz,-max_rate*dt,max_rate*dt);p.frequency_hz+=d;}
}
