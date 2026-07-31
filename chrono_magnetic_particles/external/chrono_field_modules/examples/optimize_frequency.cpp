#include "living_field/frequency_optimizer.hpp"
#include <iostream>
using namespace living_field;int main(){FrequencySearch s;s.iterations=1000;s.min_hz=0;s.max_hz=10;auto r=random_search_frequencies(2,s,[](auto&f){return (f[0]-3)*(f[0]-3)+(f[1]-7)*(f[1]-7);});std::cout<<r.frequencies_hz[0]<<' '<<r.frequencies_hz[1]<<" score="<<r.score<<"\n";}
