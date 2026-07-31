#include "living_field/field_sampler.hpp"
#include <iostream>
using namespace living_field;int main(){std::vector<MagneticNode>n(2);n[0].position={-.2,0,0};n[1].position={.2,0,0};auto s=sample_volume(n,{{-.5,-.5,-.5},{.5,.5,.5},8,8,8});double maxB=0;for(auto&q:s)maxB=std::max(maxB,length(q.B));std::cout<<s.size()<<" samples, max |B|="<<maxB<<" T\n";}
