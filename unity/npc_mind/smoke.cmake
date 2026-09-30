file(REMOVE_RECURSE ${WORK})
file(MAKE_DIRECTORY ${WORK})

execute_process(COMMAND ${NPC_MIND} seed ${WORK}/rook.tree RESULT_VARIABLE rc)
if(NOT rc EQUAL 0)
    message(FATAL_ERROR "seed failed")
endif()

file(READ ${WORK}/rook.tree fresh)
file(READ ${EXAMPLE} committed)
if(NOT fresh STREQUAL committed)
    message(FATAL_ERROR "seed output differs from examples/rook.tree; regenerate it and review the diff")
endif()

execute_process(COMMAND ${NPC_MIND} context ${WORK}/rook.tree player parts
    OUTPUT_VARIABLE packet RESULT_VARIABLE rc)
if(NOT rc EQUAL 0)
    message(FATAL_ERROR "context failed")
endif()
foreach(expected
        "\"listener\": \"Vesper\""
        "\"stance\": -0.75"
        "both knee joints sheared"
        "salvage yard"
        "Knees again.")
    string(FIND "${packet}" "${expected}" at)
    if(at EQUAL -1)
        message(FATAL_ERROR "packet is missing ${expected}:\n${packet}")
    endif()
endforeach()

execute_process(COMMAND ${NPC_MIND} say ${WORK}/rook.tree player 900 "Hauler's ready." RESULT_VARIABLE rc)
execute_process(COMMAND ${NPC_MIND} context ${WORK}/rook.tree player OUTPUT_VARIABLE packet)
string(FIND "${packet}" "Hauler's ready." at)
if(NOT rc EQUAL 0 OR at EQUAL -1)
    message(FATAL_ERROR "recorded line did not come back in the packet")
endif()
