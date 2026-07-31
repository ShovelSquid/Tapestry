#pragma once
#include "math.hpp"
#include <vector>
namespace living_field {
struct HarmonicTerm { int l{},m{}; double amplitude{},phase{},temporal_hz{}; };
double real_spherical_harmonic(int l,int m,double theta,double phi);
double radial_shape(double theta,double phi,double time,double base_radius,const std::vector<HarmonicTerm>& terms);
std::vector<Vec3> sample_shape(int theta_steps,int phi_steps,double time,double base_radius,const std::vector<HarmonicTerm>& terms);
}
