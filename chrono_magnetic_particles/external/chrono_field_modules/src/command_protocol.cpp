#include "living_field/command_protocol.hpp"
#include <sstream>
namespace living_field {
std::optional<Command> parse_command(const std::string&line,std::string*e){std::istringstream s(line);std::string op;s>>op;Command c;if(op=="frequency"){c.kind=CommandKind::SetFrequency;if(!(s>>c.node>>c.value))goto bad;}else if(op=="phase"){c.kind=CommandKind::SetPhase;if(!(s>>c.node>>c.value))goto bad;}else if(op=="axis"){c.kind=CommandKind::SetAxis;if(!(s>>c.node>>c.vector.x>>c.vector.y>>c.vector.z))goto bad;c.vector=normalized(c.vector);}else if(op=="node"){c.kind=CommandKind::CreateNode;if(!(s>>c.node>>c.vector.x>>c.vector.y>>c.vector.z))goto bad;}else if(op=="solve")c.kind=CommandKind::Solve;else goto bad;return c;bad:if(e)*e="Expected: frequency ID HZ | phase ID RAD | axis ID X Y Z | node ID X Y Z | solve";return std::nullopt;}
}
