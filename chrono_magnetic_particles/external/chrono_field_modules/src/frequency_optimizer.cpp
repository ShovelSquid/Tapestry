#include "living_field/frequency_optimizer.hpp"
namespace living_field {
FrequencyResult random_search_frequencies(size_t n,const FrequencySearch&s,const RolloutScore&score){std::mt19937 rng(s.seed);std::uniform_real_distribution<double>d(s.min_hz,s.max_hz);FrequencyResult best;best.frequencies_hz.resize(n);for(int k=0;k<s.iterations;++k){std::vector<double>x(n);for(auto&v:x)v=d(rng);double q=score(x);++best.evaluations;if(q<best.score){best.score=q;best.frequencies_hz=x;}}return best;}
}
