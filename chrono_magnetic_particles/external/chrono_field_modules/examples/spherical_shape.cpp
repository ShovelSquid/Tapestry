#include "living_field/spherical_shape.hpp"
#include <iostream>
using namespace living_field;int main(){std::vector<HarmonicTerm>t={{3,2,.2,0,.5},{5,-2,.08,1,1.5}};auto p=sample_shape(20,40,.25,1,t);std::cout<<"generated "<<p.size()<<" frequency-shaped surface points\n";}
