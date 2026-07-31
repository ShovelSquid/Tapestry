#pragma once
#include "types.hpp"
namespace living_field {
class SpinController { public:
 static double radians_per_second(double hz); static double rpm(double hz);
 static Vec3 commanded_axis(const SpinProgram& p,double time_s);
 static void apply(MagneticNode& node,double time_s,double dt);
 static void slew_frequency(SpinProgram& p,double target_hz,double max_hz_per_s,double dt);
};
}
