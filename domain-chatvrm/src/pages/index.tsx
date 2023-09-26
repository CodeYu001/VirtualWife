import { useCallback, useContext, useEffect, useRef, useState } from "react";
import VrmViewer from "@/components/vrmViewer";
import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import { Message, Screenplay, textsToScreenplay, } from "@/features/messages/messages";
import { speakCharacter } from "@/features/messages/speakCharacter";
import { MessageInputContainer } from "@/components/messageInputContainer";
import { SYSTEM_PROMPT } from "@/features/constants/systemPromptConstants";
import { DEFAULT_PARAM, KoeiroParam } from "@/features/constants/koeiroParam";
import { chat } from "@/features/chat/openAiChat";
import { connect } from "@/features/blivedm/blivedm";
// import { PhotoFrame } from '@/features/game/photoFrame';
// import { M_PLUS_2, Montserrat } from "next/font/google";
import { Introduction } from "@/components/introduction";
import { Menu } from "@/components/menu";
import { GitHubLink } from "@/components/githubLink";
import { Meta } from "@/components/meta";
import { FormDataType, getConfig, initialFormData } from "@/features/config/configApi";
import { buildUrl } from "@/utils/buildUrl";
import { buildBackgroundUrl } from "@/features/media/mediaApi";


// const m_plus_2 = M_PLUS_2({
//   variable: "--font-m-plus-2",
//   display: "swap",
//   preload: false,
// });

// const montserrat = Montserrat({
//   variable: "--font-montserrat",
//   display: "swap",
//   subsets: ["latin"],
// });

let socketInstance: WebSocket | null = null;
let bind_message_event = false;

export default function Home() {

    const { viewer } = useContext(ViewerContext);
    const [systemPrompt, setSystemPrompt] = useState(SYSTEM_PROMPT);
    const [openAiKey, setOpenAiKey] = useState("");
    const [koeiroParam, setKoeiroParam] = useState<KoeiroParam>(DEFAULT_PARAM);
    const [chatProcessing, setChatProcessing] = useState(false);
    const [chatLog, setChatLog] = useState<Message[]>([]);
    const [assistantMessage, setAssistantMessage] = useState("");
    const [imageUrl, setImageUrl] = useState('');
    const [globalsConfig, setGlobalsConfig] = useState<FormDataType>(initialFormData);
    const [subtitle, setSubtitle] = useState("");
    const [displayedSubtitle, setDisplayedSubtitle] = useState("");
    const [backgroundImageUrl, setBackgroundImageUrl] = useState<string>(buildUrl("/bg-c.png"));
    const typingDelay = 100; // 每个字的延迟时间，可以根据需要进行调整
    const handleSubtitle = (newSubtitle: string) => {
        setDisplayedSubtitle(newSubtitle);
        setSubtitle((prevSubtitle) => prevSubtitle + newSubtitle);
        setTimeout(clearSubtitle, 3000); // 3秒后清空字幕
    };

    const clearSubtitle = () => {
        setDisplayedSubtitle("");
        setSubtitle("");
    };

    useEffect(() => {
        getConfig().then(data => {
            setGlobalsConfig(data)
            if(data.background_url != ''){
                setBackgroundImageUrl(buildBackgroundUrl(data.background_url))
            }
        })
        if (window.localStorage.getItem("chatVRMParams")) {
            const params = JSON.parse(
                window.localStorage.getItem("chatVRMParams") as string
            );
            setSystemPrompt(params.systemPrompt);
            setKoeiroParam(params.koeiroParam);
            setChatLog(params.chatLog);
        }
    }, []);

    useEffect(() => {
        process.nextTick(() =>
            window.localStorage.setItem(
                "chatVRMParams",
                JSON.stringify({ systemPrompt, koeiroParam, chatLog })
            )
        );
    }, [systemPrompt, koeiroParam, chatLog]);

    const handleChangeChatLog = useCallback(
        (targetIndex: number, text: string) => {
            const newChatLog = chatLog.map((v: Message, i) => {
                return i === targetIndex ? { role: v.role, content: text } : v;
            });
            setChatLog(newChatLog);
        },
        [chatLog]
    );

    /**
     * 文ごとに音声を直列でリクエストしながら再生する
     */
    const handleSpeakAi = useCallback(
        async (
            screenplay: Screenplay,
            onStart?: () => void,
            onEnd?: () => void
        ) => {
            speakCharacter(screenplay, viewer, onStart, onEnd);
        },
        [viewer]
    );

    const handleChatMessage = (
        type: string,
        user_name: string,
        content: string,
        emote: string) => {

        console.log("RobotMessage:" + content + " emote:" + emote)
        // 如果content为空，不进行处理
        // 如果与上一句content完全相同，不进行处理
        if (content == null || content == '' || content == ' ') {
            return
        }
        let aiTextLog = "";
        const sentences = new Array<string>();
        const aiText = content;
        const aiTalks = textsToScreenplay([aiText], koeiroParam, emote);
        aiTextLog += aiText;
        // 文ごとに音声を生成 & 再生、返答を表示
        const currentAssistantMessage = sentences.join(" ");
        setSubtitle(aiTextLog);
        handleSpeakAi(aiTalks[0], () => {
            setAssistantMessage(currentAssistantMessage);
            handleSubtitle(aiText + " "); // 添加空格以区分不同的字幕
        });

    }

    /**
     * アシスタントとの会話を行う
     */
    const handleSendChat = useCallback(
        async (type: string, user_name: string, content: string) => {

            console.log("UserMessage:" + content)

            setChatProcessing(true);
            // ユーザーの発言を追加して表示
            const messageLog: Message[] = [
                ...chatLog,
                { role: "user", content: content },
            ];
            setChatLog(messageLog);

            const yourName = user_name == null || user_name == '' ? globalsConfig?.characterConfig?.yourName : user_name
            await chat(content, yourName).catch(
                (e) => {
                    console.error(e);
                    return null;
                }
            );

            setChatProcessing(false);
        },
        [systemPrompt, chatLog, setChatLog, handleSpeakAi, setImageUrl, openAiKey, koeiroParam]
    );

    const handleWebSocketMessage = (event: MessageEvent) => {
        const data = event.data;
        const chatMessage = JSON.parse(data);
        const type = chatMessage.message.type;
        if (type === "user") {
            handleChatMessage(
                chatMessage.message.type,
                chatMessage.message.user_name,
                chatMessage.message.content,
                chatMessage.message.emote,
            );
        }
    };

    const setupWebSocket = () => {
        connect().then((webSocket) => {
            socketInstance = webSocket;
            socketInstance.onmessage = handleWebSocketMessage; // Set onmessage listener
            socketInstance.onclose = (event) => {
                console.log('WebSocket connection closed:', event);
                console.log('Reconnecting...');
                setupWebSocket(); // 重新调用connect()函数进行连接
            };
        });
    }

    useEffect(() => {
        if (!bind_message_event) {
            console.log(">>>> setupWebSocket")
            setupWebSocket(); // Set up WebSocket when component mounts
            bind_message_event = true;
        }
    }, []);

    return (
        <div
            style={{
                backgroundImage: `url(${backgroundImageUrl})`,
                backgroundSize: 'cover',
                width: '100%',
                height: '100vh',
                position: 'relative',
                zIndex: 1,
            }}>
            <div>
                <Meta />
                <Introduction openAiKey={openAiKey} onChangeAiKey={setOpenAiKey} />
                <VrmViewer globalsConfig={globalsConfig} />
                <div className="flex items-center justify-center">
                    <div className="absolute bottom-1/4 z-10" style={{
                        fontFamily: "fzfs",
                        fontSize: "24px",
                        color: "#555",
                    }}>
                        {displayedSubtitle}
                    </div>
                </div>
                <MessageInputContainer
                    isChatProcessing={chatProcessing}
                    onChatProcessStart={handleSendChat}
                />
                <Menu
                    globalsConfig={globalsConfig}
                    openAiKey={openAiKey}
                    systemPrompt={systemPrompt}
                    chatLog={chatLog}
                    koeiroParam={koeiroParam}
                    assistantMessage={assistantMessage}
                    onChangeAiKey={setOpenAiKey}
                    onChangeSystemPrompt={setSystemPrompt}
                    onChangeChatLog={handleChangeChatLog}
                    onChangeKoeiromapParam={setKoeiroParam}
                    handleClickResetChatLog={() => setChatLog([])}
                    handleClickResetSystemPrompt={() => setSystemPrompt(SYSTEM_PROMPT)}
                />
                <GitHubLink />
            </div>
        </div>
    )
}
